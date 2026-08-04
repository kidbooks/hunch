/* ==========================================================================
   Nicky's Secret — read-free page reader
   Plain ES5-compatible JavaScript. No jQuery, no turn.js, no build step.

   HOW THE PAGE TURN WORKS
   -----------------------
   A real page folds along a straight crease. When you drag corner C of a
   sheet to point P, the crease is the perpendicular bisector of the segment
   CP — because the folded flap is exactly the reflection of the sheet across
   that line. Everything below follows from that one fact:

     * the part of the sheet on the spine side of the crease stays flat and
       keeps showing the page you were reading            -> .fold__front
     * the part beyond the crease is reflected across it and shows the
       reverse face of the sheet, mirrored                -> .fold__flap
     * whatever the sheet was covering becomes visible    -> .fold__under

   Each layer is the same rectangle; the two visible shapes are produced by
   clipping that rectangle against the crease with clip-path, and the flap
   additionally carries a 2-D reflection matrix. No 3-D transforms are used,
   which keeps this cheap and predictable on iOS.

   The corner is constrained to a circle of radius = page width centred on
   the spine, because paper cannot stretch. That means a whole turn is just
   one angle sweeping 0 -> PI, which is also what the tap/keyboard/button
   turns animate.
   ========================================================================== */

(function () {
	'use strict';

	/* ----------------------------------------------------------------------
	   1. Book configuration — the only part you edit when the book changes
	   ---------------------------------------------------------------------- */

	var PAGE_COUNT       = 40;                             // total page images
	var PAGE_SRC         = function (n) { return 'pages/' + n + '.jpg'; };
	var PAGE_ASPECT      = 1;                              // width / height of ONE page
	var SPREAD_MIN_RATIO = 1.3;                            // show two pages above this screen ratio
	var PRELOAD_RADIUS   = 3;                              // pages fetched either side of the current one
	var TURN_MS          = 460;                            // full-turn animation length
	var IDLE_MS          = 3500;                           // dim the controls after this long
	var DRAG_SLOP        = 6;                              // px of movement before a press counts as a drag
	var SWIPE_MIN        = 45;                             // px of travel that counts as a swipe

	var LEAVES = Math.ceil(PAGE_COUNT / 2);                // physical sheets of paper

	/* ----------------------------------------------------------------------
	   2. DOM
	   ---------------------------------------------------------------------- */

	var reader   = document.getElementById('reader');
	var stage    = document.getElementById('stage');
	var foldEl   = document.getElementById('fold');
	var counter  = document.getElementById('counter');
	var spinner  = document.getElementById('spinner');
	var prevBtn  = document.getElementById('prevBtn');
	var nextBtn  = document.getElementById('nextBtn');
	var fullBtn  = document.getElementById('fullscreenBtn');

	var pageLeft  = stage.querySelector('.page--left');
	var pageRight = stage.querySelector('.page--right');
	var underEl   = foldEl.querySelector('.fold__under');
	var frontEl   = foldEl.querySelector('.fold__front');
	var flapEl    = foldEl.querySelector('.fold__flap');
	var creaseEl  = foldEl.querySelector('.fold__crease');
	var shadeEl   = foldEl.querySelector('.fold__shade');

	/* ----------------------------------------------------------------------
	   3. State
	   ---------------------------------------------------------------------- */

	var spread   = true;   // true = two-page spread, false = one page at a time
	var leaf     = 0;      // spread mode: how many sheets have been turned (0..LEAVES)
	var page     = 1;      // single-page mode: the page on screen (1..PAGE_COUNT)

	var stageBox = { w: 0, h: 0 };          // book size in px
	var sheet    = { x: 0, w: 0, h: 0 };    // rectangle of the sheet that turns
	var stageOff = { x: 0, y: 0 };          // stage position on screen, cached for pointer maths

	var fold     = null;   // active turn, see beginFold()
	var animRAF  = 0;      // non-zero while a turn is animating itself
	var idleTimer = 0;

	var reduceMotion = window.matchMedia
		? window.matchMedia('(prefers-reduced-motion: reduce)').matches
		: false;

	/* ----------------------------------------------------------------------
	   4. Small helpers
	   ---------------------------------------------------------------------- */

	function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

	function now() { return Date.now(); }

	function easeOut(t) { return 1 - Math.pow(1 - t, 3); }   // cubic ease-out

	/* Put page n into a page-sized box, or hide the box when n is 0. */
	function setPage(box, n) {
		if (!n) { box.hidden = true; return; }
		var img = box.firstElementChild;
		var src = PAGE_SRC(n);
		if (img.getAttribute('src') !== src) { img.setAttribute('src', src); }
		box.hidden = false;
	}

	/* Give a box a rectangle, in stage-local pixels. */
	function place(box, x, w, h) {
		box.style.left   = x + 'px';
		box.style.width  = w + 'px';
		box.style.height = h + 'px';
	}

	/* ----------------------------------------------------------------------
	   5. Which page goes where
	   ---------------------------------------------------------------------- */

	/* Sheet i carries page 2i+1 on its front and page 2i+2 on its back, so
	   with `leaf` sheets turned the reader sees page 2*leaf on the left and
	   page 2*leaf+1 on the right. 0 means "no page there". */
	function visiblePages() {
		if (!spread) { return { left: 0, right: page }; }
		return {
			left:  leaf > 0      ? 2 * leaf     : 0,
			right: leaf < LEAVES ? 2 * leaf + 1 : 0
		};
	}

	/*
	   The four page slots a turn needs. The turning sheet always occupies the
	   right-hand rectangle (or the whole stage in single-page mode) — a
	   backwards turn is simply the same sheet swinging back into that space
	   from the left, i.e. the same animation played from PI down to 0.

	   Returns null when there is nothing to turn.
	*/
	function foldPages(dir) {
		if (spread) {
			if (dir > 0) {
				if (leaf >= LEAVES) { return null; }
				return {
					front: 2 * leaf + 1,                                    // face you are leaving
					back:  2 * leaf + 2 <= PAGE_COUNT ? 2 * leaf + 2 : 0,   // reverse of that sheet
					under: 2 * leaf + 3 <= PAGE_COUNT ? 2 * leaf + 3 : 0,   // revealed beneath it
					left:  leaf > 0 ? 2 * leaf : 0                          // facing page, unchanged
				};
			}
			if (leaf <= 0) { return null; }
			return {
				front: 2 * leaf - 1,
				back:  2 * leaf,
				under: leaf < LEAVES ? 2 * leaf + 1 : 0,
				left:  leaf > 1 ? 2 * leaf - 2 : 0                          // facing page after the turn
			};
		}

		/* Single-page mode. There is no facing page, so each *page* behaves as
		   its own sheet: its reverse is the page you are turning towards, and
		   that same page is what lies underneath. */
		if (dir > 0) {
			if (page >= PAGE_COUNT) { return null; }
			return { front: page, back: page + 1, under: page + 1, left: 0 };
		}
		if (page <= 1) { return null; }
		/* under stays on the *current* page so the screen does not jump to the
		   destination before the sheet has swung back over it. */
		return { front: page - 1, back: page, under: page, left: 0 };
	}

	/* ----------------------------------------------------------------------
	   6. Geometry
	   ---------------------------------------------------------------------- */

	/*
	   Sutherland–Hodgman clip of a convex polygon against the half-plane
	   dot(p - q, nrm) <= 0. Used twice per frame: once with the crease normal
	   to get the flat part, once with it negated to get the folded part.
	*/
	function clipHalfPlane(poly, q, nx, ny) {
		var out = [], i, a, b, da, db, t;
		for (i = 0; i < poly.length; i++) {
			a = poly[i];
			b = poly[(i + 1) % poly.length];
			da = (a[0] - q[0]) * nx + (a[1] - q[1]) * ny;
			db = (b[0] - q[0]) * nx + (b[1] - q[1]) * ny;
			if (da <= 0) { out.push(a); }
			if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
				t = da / (da - db);
				out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
			}
		}
		return out;
	}

	function toClipPath(poly) {
		if (poly.length < 3) { return 'polygon(0 0, 0 0, 0 0)'; }   // nothing visible
		var parts = [], i;
		for (i = 0; i < poly.length; i++) {
			parts.push(poly[i][0].toFixed(2) + 'px ' + poly[i][1].toFixed(2) + 'px');
		}
		return 'polygon(' + parts.join(', ') + ')';
	}

	/* clip-path still needs the -webkit- prefix on older iOS Safari. */
	function setClip(el, value) {
		el.style.webkitClipPath = value;
		el.style.clipPath = value;
	}

	/*
	   Position one of the thin gradient bands that sit along the crease.
	   `side` is +1 to lay the band on the folded side of the crease (the flap's
	   shading) or -1 for the flat side (the crease shadow on the page).
	*/
	function placeBand(el, qx, qy, angle, depth, length, side) {
		var offY = side > 0 ? 0 : -depth;
		el.style.width  = length + 'px';
		el.style.height = depth + 'px';
		el.style.transform =
			'translate(' + qx.toFixed(2) + 'px,' + qy.toFixed(2) + 'px) ' +
			'rotate(' + angle.toFixed(4) + 'rad) ' +
			'translate(' + (-length / 2) + 'px,' + offY + 'px)';
	}

	/*
	   Redraw the active fold from its current angle. Called on every drag move
	   and every animation frame — this is the only hot path in the file.
	*/
	function drawFold() {
		var W = sheet.w, H = sheet.h;
		var cornerY = fold.dirY > 0 ? 0 : H;          // grabbed the top or bottom corner
		var cx = W, cy = cornerY;                     // C: the corner, at rest
		var sx = 0, sy = cornerY;                     // S: same corner at the spine

		/* P: where the corner has been dragged to, on its circle around S. */
		var px = sx + fold.r * Math.cos(fold.a);
		var py = sy + fold.dirY * fold.r * Math.sin(fold.a);

		var vx = cx - px, vy = cy - py;
		var len = Math.sqrt(vx * vx + vy * vy);

		/* Corner still home: nothing folded, page lies flat. */
		if (len < 1) {
			setClip(frontEl, 'polygon(0 0, 100% 0, 100% 100%, 0 100%)');
			setClip(flapEl, 'polygon(0 0, 0 0, 0 0)');
			creaseEl.style.height = '0px';
			return;
		}

		var nx = vx / len, ny = vy / len;             // unit normal, pointing towards C
		var qx = (cx + px) / 2, qy = (cy + py) / 2;   // a point on the crease

		/* Crease direction, chosen so that its local +y axis points along n. */
		var dx = ny, dy = -nx;
		var angle = Math.atan2(dy, dx);

		var rect = [[0, 0], [W, 0], [W, H], [0, H]];
		var flat   = clipHalfPlane(rect, [qx, qy],  nx,  ny);   // spine side
		var folded = clipHalfPlane(rect, [qx, qy], -nx, -ny);   // corner side

		setClip(frontEl, toClipPath(flat));
		setClip(flapEl,  toClipPath(folded));

		/*
		   Reflection across the crease, as a CSS 2-D matrix. For a crease at
		   angle t the linear part is [cos2t, sin2t; sin2t, -cos2t], and the
		   translation puts the crease back through the point (qx, qy).
		*/
		var A = dx * dx - dy * dy;     // cos 2t
		var B = 2 * dx * dy;           // sin 2t
		var e = qx - (A * qx + B * qy);
		var f = qy - (B * qx - A * qy);
		flapEl.style.transform =
			'matrix(' + A.toFixed(6) + ',' + B.toFixed(6) + ',' +
			            B.toFixed(6) + ',' + (-A).toFixed(6) + ',' +
			            e.toFixed(2) + ',' + f.toFixed(2) + ')';

		/* Shading. The bands fade out over a depth that scales with the page so
		   the crease looks the same on a phone and on a desktop monitor. */
		var depth  = clamp(W * 0.11, 14, 64);
		var length = (W + H) * 2;
		placeBand(shadeEl,  qx, qy, angle, depth, length,  1);
		placeBand(creaseEl, qx, qy, angle, depth, length, -1);
	}

	/* ----------------------------------------------------------------------
	   7. Rendering
	   ---------------------------------------------------------------------- */

	function render() {
		var v = visiblePages();
		setPage(pageLeft,  v.left);
		setPage(pageRight, v.right);

		/* The covers are single pages sitting in one half of the spread, so the
		   book slides sideways to stay centred on screen. CSS transitions the
		   move, which is why it happens after the turn rather than during it. */
		var shift = 0;
		if (spread) {
			if (!v.left)       { shift = -25; }   // front cover: only the right page
			else if (!v.right) { shift =  25; }   // back cover: only the left page
		}
		stage.style.transform = 'translateX(' + shift + '%) translateZ(0)';

		/* Page counter and end-stop buttons. */
		if (spread) {
			counter.textContent = (v.left && v.right ? v.left + '\u2013' + v.right
			                                        : (v.right || v.left)) + ' / ' + PAGE_COUNT;
			prevBtn.disabled = leaf <= 0;
			nextBtn.disabled = leaf >= LEAVES;
		} else {
			counter.textContent = page + ' / ' + PAGE_COUNT;
			prevBtn.disabled = page <= 1;
			nextBtn.disabled = page >= PAGE_COUNT;
		}

		preload();
	}

	/* Prepare the three fold layers for a turn. */
	function paintFold(p) {
		setPage(underEl, p.under);
		setPage(frontEl, p.front);
		setPage(flapEl,  p.back);

		/* The sheet's own rectangle is covered by the fold layers, so hide the
		   flat page there. The facing page is set to whatever should be seen
		   once the turn completes; the flap covers it until then. */
		setPage(spread ? pageLeft : pageRight, spread ? p.left : 0);
		if (spread) { pageRight.hidden = true; }

		foldEl.hidden = false;
	}

	/* ----------------------------------------------------------------------
	   8. Layout
	   ---------------------------------------------------------------------- */

	function layout() {
		var vw = window.innerWidth;
		var vh = window.innerHeight;

		/* iOS Safari's 100vh is the *large* viewport, so it hides content behind
		   the toolbar. innerHeight is the honest number. */
		reader.style.height = vh + 'px';

		/* Two pages when the screen is comfortably wider than it is tall. */
		var wasSpread = spread;
		spread = (vw / vh) >= SPREAD_MIN_RATIO;
		if (spread !== wasSpread) {
			if (spread) { leaf = Math.floor(page / 2); }
			else        { page = Math.min(2 * leaf + 1, PAGE_COUNT); }
		}
		/* classList, not className: a resize must not wipe the idle state. */
		if (spread) { reader.classList.remove('is-single'); }
		else        { reader.classList.add('is-single'); }

		/* Fit the book inside the screen, leaving room for the floating chrome. */
		var pad   = clamp(Math.round(Math.min(vw, vh) * 0.035), 8, 28);
		var availW = vw - pad * 2;
		var availH = vh - pad * 2 - 68;               // 34px of chrome top and bottom
		var ratio  = spread ? PAGE_ASPECT * 2 : PAGE_ASPECT;

		var w = availW, h = w / ratio;
		if (h > availH) { h = availH; w = h * ratio; }
		if (spread) { w = Math.round(w / 2) * 2; }    // even width: no seam at the spine
		else        { w = Math.round(w); }
		h = Math.round(w / ratio);

		stageBox.w = w;
		stageBox.h = h;
		stage.style.width  = w + 'px';
		stage.style.height = h + 'px';
		stage.style.left   = Math.round((vw - w) / 2) + 'px';
		stage.style.top    = Math.round((vh - h) / 2) + 'px';

		/* The turning sheet lives in the right-hand half (or the whole stage). */
		sheet.x = spread ? w / 2 : 0;
		sheet.w = spread ? w / 2 : w;
		sheet.h = h;

		place(pageLeft,  0, spread ? w / 2 : w, h);
		place(pageRight, sheet.x, sheet.w, h);
		place(underEl,   sheet.x, sheet.w, h);
		place(frontEl,   sheet.x, sheet.w, h);
		place(flapEl,    sheet.x, sheet.w, h);

		cacheStageOffset();
		cancelFold();          // sheet geometry just changed; drop any turn in progress
		render();
	}

	function cacheStageOffset() {
		var r = stage.getBoundingClientRect();
		stageOff.x = r.left;
		stageOff.y = r.top;
	}

	/* ----------------------------------------------------------------------
	   9. Turning
	   ---------------------------------------------------------------------- */

	/* Start a turn. `localY` picks the top or bottom corner to fold. */
	function beginFold(dir, localY) {
		var p = foldPages(dir);
		if (!p) { return false; }
		fold = {
			dir:  dir,
			dirY: localY < sheet.h / 2 ? 1 : -1,
			a:    dir > 0 ? 0 : Math.PI,     // forwards starts flat, backwards starts turned
			r:    sheet.w,
			pages: p
		};
		paintFold(p);
		drawFold();
		return true;
	}

	function cancelFold() {
		if (animRAF) { cancelAnimationFrame(animRAF); animRAF = 0; }
		if (!fold) { return; }
		fold = null;
		foldEl.hidden = true;
	}

	/* Run the fold angle to `target`, then either commit the turn or drop it. */
	function animateFold(target, commit) {
		var startA = fold.a, startR = fold.r;
		var span   = Math.abs(target - startA) / Math.PI;
		var dur    = reduceMotion ? 1 : Math.max(150, TURN_MS * span);
		var t0     = now();

		function step() {
			var k = easeOut(clamp((now() - t0) / dur, 0, 1));
			fold.a = startA + (target - startA) * k;
			fold.r = startR + (sheet.w - startR) * k;
			drawFold();
			if (k < 1) {
				animRAF = requestAnimationFrame(step);
			} else {
				animRAF = 0;
				if (commit) {
					if (spread) { leaf += fold.dir; } else { page += fold.dir; }
				}
				fold = null;
				foldEl.hidden = true;
				render();
			}
		}
		animRAF = requestAnimationFrame(step);
	}

	/* A complete turn triggered by a button, key, tap or swipe. */
	function turnPage(dir) {
		if (animRAF || fold) { return; }
		if (!beginFold(dir, sheet.h)) { return; }        // fold the bottom corner
		animateFold(dir > 0 ? Math.PI : 0, true);
	}

	/* ----------------------------------------------------------------------
	   10. Pointer input
	   Touch and mouse are handled separately rather than through Pointer
	   Events, so this works unchanged on older iOS versions.
	   ---------------------------------------------------------------------- */

	var press = null;   // { x0, y0, lastX, lastT, vx, moved, dragging }

	function onDown(x, y) {
		if (animRAF) { return; }
		wake();
		cacheStageOffset();

		press = { x0: x, y0: y, lastX: x, lastT: now(), vx: 0, moved: false, dragging: false };

		var lx = x - stageOff.x;                    // stage-local coordinates
		var ly = y - stageOff.y;
		if (ly < 0 || ly > stageBox.h) { return; }  // pressed above or below the book

		/* Grab zones: the outer edges of the book start a fold immediately.
		   A press in the middle is treated as a swipe instead. */
		var edge = spread ? 0.28 : 0.34;
		var dir  = 0;
		if (lx > stageBox.w * (1 - edge)) { dir = 1; }
		else if (lx < stageBox.w * edge)  { dir = -1; }
		if (!dir) { return; }

		if (beginFold(dir, ly)) { press.dragging = true; }
	}

	function onMove(x, y) {
		if (!press) { return; }

		var t = now();
		if (t > press.lastT) { press.vx = (x - press.lastX) / (t - press.lastT); }  // px/ms
		press.lastX = x;
		press.lastT = t;

		if (Math.abs(x - press.x0) > DRAG_SLOP || Math.abs(y - press.y0) > DRAG_SLOP) {
			press.moved = true;
		}
		if (!press.dragging || !fold) { return; }

		/*
		   Move the folded corner by the same amount the finger moved, starting
		   from wherever the corner sits at the fold's opening angle. Doing it
		   as a delta means the page never jumps to meet the finger.
		*/
		var cornerY = fold.dirY > 0 ? 0 : sheet.h;
		var p0x = sheet.w * Math.cos(fold.dir > 0 ? 0 : Math.PI);
		var px  = p0x + (x - press.x0);
		var py  = cornerY + (y - press.y0);

		/*
		   Paper cannot stretch, so the corner stays within one page-width of
		   the spine. The sweep is clamped to the half-plane *before* atan2
		   rather than clamping the resulting angle afterwards: dragging along
		   the corner's own row makes the sweep exactly zero, and a negative
		   zero there would send atan2 to -PI and snap the page flat again —
		   which is precisely what a plain horizontal swipe produces.
		*/
		var dx = px;
		var dy = Math.max(fold.dirY * (py - cornerY), 0);
		fold.r = clamp(Math.sqrt(dx * dx + dy * dy), 0, sheet.w);
		fold.a = Math.atan2(dy, dx);            // already within [0, PI]
		drawFold();
	}

	function onUp() {
		if (!press) { return; }
		var p = press;
		press = null;
		if (!fold || !p.dragging) {
			/* No fold started — a horizontal swipe across the middle still turns. */
			if (p.moved && Math.abs(p.lastX - p.x0) > SWIPE_MIN) {
				turnPage(p.lastX < p.x0 ? 1 : -1);
			}
			return;
		}

		/* A press without movement is a tap on the corner: complete the turn. */
		if (!p.moved) { animateFold(fold.dir > 0 ? Math.PI : 0, true); return; }

		/*
		   Otherwise decide on how far across the page the corner got, with a
		   nudge for anyone who flicks quickly. Progress is measured from the
		   corner's horizontal position rather than the fold angle: a straight
		   horizontal drag holds the angle at 0 until the corner crosses the
		   spine, so an angle-based test would ignore short, fast swipes.
		*/
		var cornerX  = fold.r * Math.cos(fold.a);                 // +w at rest, -w when turned
		var crossed  = (sheet.w - cornerX) / (2 * sheet.w);       // 0 -> 1 over a full turn
		var progress = fold.dir > 0 ? crossed : 1 - crossed;
		var flicked  = p.vx * fold.dir < -0.4;                    // px/ms towards the turn
		var complete = progress > 0.5 || (progress > 0.15 && flicked);

		if (complete) { animateFold(fold.dir > 0 ? Math.PI : 0, true); }
		else          { animateFold(fold.dir > 0 ? 0 : Math.PI, false); }
	}

	/*
	   One set of handlers, two input families — touch and mouse are bound
	   separately rather than via Pointer Events so nothing depends on a Safari
	   version. iOS fires synthetic mouse events after every touch, so mouse
	   input is ignored for a moment afterwards. It is a *recent-touch* test,
	   not a permanent flag, because an iPad with a trackpad legitimately uses
	   both in the same session.
	*/
	var lastTouch = 0;
	function isGhostMouse() { return now() - lastTouch < 700; }

	stage.addEventListener('touchstart', function (e) {
		lastTouch = now();
		if (e.touches.length !== 1) { return; }
		onDown(e.touches[0].clientX, e.touches[0].clientY);
	}, { passive: true });

	stage.addEventListener('touchmove', function (e) {
		lastTouch = now();
		if (e.touches.length !== 1) { return; }
		onMove(e.touches[0].clientX, e.touches[0].clientY);
		if (press && press.dragging) { e.preventDefault(); }   // no scroll or rubber-band
	}, { passive: false });

	function endTouch() { lastTouch = now(); onUp(); }
	stage.addEventListener('touchend', endTouch);
	stage.addEventListener('touchcancel', endTouch);

	stage.addEventListener('mousedown', function (e) {
		if (isGhostMouse() || e.button !== 0) { return; }
		e.preventDefault();
		onDown(e.clientX, e.clientY);
	});
	window.addEventListener('mousemove', function (e) {
		if (!isGhostMouse()) { onMove(e.clientX, e.clientY); }
	});
	window.addEventListener('mouseup', function () { if (!isGhostMouse()) { onUp(); } });

	/* Buttons and keyboard. */
	prevBtn.addEventListener('click', function () { wake(); turnPage(-1); });
	nextBtn.addEventListener('click', function () { wake(); turnPage(1); });

	document.addEventListener('keydown', function (e) {
		var k = e.key;
		if (k === 'ArrowRight' || k === 'PageDown')     { wake(); turnPage(1);  e.preventDefault(); }
		else if (k === 'ArrowLeft' || k === 'PageUp')   { wake(); turnPage(-1); e.preventDefault(); }
	});

	/* ----------------------------------------------------------------------
	   11. Fullscreen
	   The API is well supported on desktop and iPadOS but has never been
	   dependable on iPhone, so the button hides itself where it is absent and
	   the reader simply stays full-viewport instead.
	   ---------------------------------------------------------------------- */

	var root = document.documentElement;
	var enterFS = root.requestFullscreen || root.webkitRequestFullscreen;
	var exitFS  = document.exitFullscreen || document.webkitExitFullscreen;

	function inFullscreen() {
		return !!(document.fullscreenElement || document.webkitFullscreenElement);
	}

	function syncFullscreenBtn() {
		var on = inFullscreen();
		fullBtn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Enter fullscreen');
		fullBtn.querySelector('.ctl__label').textContent = on ? 'Exit' : 'Fullscreen';
	}

	if (enterFS && exitFS) {
		fullBtn.hidden = false;
		fullBtn.addEventListener('click', function () {
			wake();
			try {
				if (inFullscreen()) { exitFS.call(document); }
				else { enterFS.call(root); }
			} catch (err) { /* user gesture rejected — leave the reader as it is */ }
		});
		document.addEventListener('fullscreenchange', syncFullscreenBtn);
		document.addEventListener('webkitfullscreenchange', syncFullscreenBtn);
	}

	/* ----------------------------------------------------------------------
	   12. Idle chrome, image preloading, boot
	   ---------------------------------------------------------------------- */

	function wake() {
		reader.classList.remove('is-idle');
		clearTimeout(idleTimer);
		idleTimer = setTimeout(function () { reader.classList.add('is-idle'); }, IDLE_MS);
	}

	var preloaded = {};
	function preload() {
		var centre = spread ? 2 * leaf + 1 : page;
		for (var i = -PRELOAD_RADIUS; i <= PRELOAD_RADIUS; i++) {
			var n = centre + i;
			if (n < 1 || n > PAGE_COUNT || preloaded[n]) { continue; }
			preloaded[n] = true;
			new Image().src = PAGE_SRC(n);
		}
	}

	/* Hide the spinner once the first page is actually on screen. */
	function watchFirstPaint() {
		var img = pageRight.firstElementChild;
		function done() { spinner.hidden = true; }
		if (img.complete && img.naturalWidth) { done(); return; }
		img.addEventListener('load', done);
		img.addEventListener('error', done);
	}

	/* A resize during a turn would invalidate the fold geometry, so layout()
	   drops any turn in progress. Debounced because iOS fires these in bursts. */
	var resizeTimer = 0;
	function scheduleLayout(delay) {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(layout, delay || 60);
	}

	window.addEventListener('resize', function () { scheduleLayout(); });
	window.addEventListener('orientationchange', function () { scheduleLayout(250); });
	if (window.visualViewport) {
		/* Fires when the iOS toolbar collapses or expands. */
		window.visualViewport.addEventListener('resize', function () { scheduleLayout(120); });
	}

	['mousemove', 'touchstart', 'keydown'].forEach(function (evt) {
		document.addEventListener(evt, wake, { passive: true });
	});

	layout();
	watchFirstPaint();
	wake();

}());
