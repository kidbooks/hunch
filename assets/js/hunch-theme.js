/* ============================================================
   THE HUNCH TRAIL — SHARED BEHAVIOUR
   Footer year, sticky header (shadow + auto-hide on touch),
   mobile nav toggle, scroll reveal, and a generic lightbox.
   Safe to include on every page — each piece checks the DOM
   before it does anything, so pages without a given element
   (e.g. no .enlarge triggers) just skip that part.
============================================================ */
(function(){
	"use strict";

	/* The site's single definition of "this visitor has a real mouse".
	   Deliberately the same media query the CSS uses (see the
	   auto-hiding header in hunch-theme.css, and the loupe / instruction
	   copy on the homepage), so script and stylesheet can never disagree
	   about what kind of device they are running on. */
	var POINTER_FINE = '(hover: hover) and (pointer: fine)';

	/* Older versions of iOS Safari only expose the deprecated
	   addListener() on a MediaQueryList rather than addEventListener().
	   One helper covers both spellings so the rest of the file doesn't
	   have to care. */
	function onMediaChange(mql, handler){
		if (mql.addEventListener) mql.addEventListener('change', handler);
		else if (mql.addListener) mql.addListener(handler);
	}

	/* Elements shared by more than one block below, looked up once. */
	var header = document.getElementById('header');
	var navToggle = document.getElementById('navToggle');
	var siteNav = document.getElementById('siteNav');

	function navIsOpen(){
		return !!siteNav && siteNav.classList.contains('is-open');
	}

	/* ============================================================
	   FOOTER YEAR
	============================================================ */
	var yearEl = document.getElementById('thisYear');
	if (yearEl) yearEl.textContent = new Date().getFullYear();

	/* ============================================================
	   OVERLAY HISTORY — shared by the menu and the lightbox
	   ------------------------------------------------------------
	   Both the mobile menu and the lightbox are "overlays": things
	   that open on top of the page, which a visitor expects the
	   device Back button (or the iOS swipe-back gesture) to close
	   rather than to leave the page entirely.

	   The browser gives one hook for that: a history entry. Opening
	   an overlay pushes one, so Back pops that entry and fires
	   'popstate' instead of navigating away. Closing the overlay any
	   other way gives the entry back, so the stack never grows and a
	   second Back press behaves completely normally.

	   This logic is shared rather than written once per overlay for a
	   concrete reason: only ONE such entry may exist at a time. Two
	   independent copies would fight each other — tapping an image
	   while the menu is open closes the menu and opens the lightbox
	   within the same click, and history.back() is asynchronous, so
	   the menu's pop would land a moment after the lightbox pushed
	   its own entry and close it again. Here the entry is simply
	   handed from one overlay to the other.

	   An "overlay" is any object with a close() method that touches
	   only the DOM; all history handling happens in here.
	============================================================ */
	var OverlayHistory = (function(){
		var current = null;   /* the overlay on screen right now, if any */
		var owned = false;    /* is one of our entries on the stack?     */

		function open(overlay){
			/* Something else already showing? Close it, but keep its
			   history entry — this is the hand-over described above. */
			if (current && current !== overlay) current.close();
			current = overlay;
			if (!owned) {
				/* Guarded because some browsers refuse history writes
				   on a page opened straight from disk (a file:// URL,
				   i.e. double-clicking the .html file to preview it).
				   If the push is refused, the overlay still opens and
				   still closes by every other means — only the Back
				   button loses its shortcut, and owned stays false so
				   nothing later tries to pop an entry we never got. */
				try {
					history.pushState({hunchOverlay:true}, '');
					owned = true;
				} catch (err) { owned = false; }
			}
		}

		/* Dismissed by the overlay's own UI: its close button, a tap
		   outside it, Escape, or the menu toggle a second time. */
		function close(overlay){
			if (current !== overlay) return;
			current = null;
			overlay.close();
			/* Deferred by one tick so that a single click which closes
			   one overlay and opens another hands the entry over
			   instead of popping it out from under the new one. */
			setTimeout(function(){
				if (current || !owned) return;
				owned = false;
				history.back();
			}, 0);
		}

		/* Use instead of close() when the caller is about to overwrite
		   our history entry itself with location.replace() — see the
		   menu-link handler further down. */
		function discard(overlay){
			if (current !== overlay) return;
			current = null;
			owned = false;
			overlay.close();
		}

		/* Escape closes whatever is on top, whichever overlay that is. */
		function closeTop(){ if (current) close(current); }

		/* Back button / swipe-back: our entry has just been popped, so
		   the overlay closes and we no longer own an entry. Nothing is
		   pushed back — the visitor asked to go back, and they did. */
		window.addEventListener('popstate', function(){
			owned = false;
			if (current) {
				var overlay = current;
				current = null;
				overlay.close();
			}
		});

		return {open:open, close:close, discard:discard, closeTop:closeTop};
	})();

	/* Escape key, once, for every overlay on the page. */
	document.addEventListener('keydown', function(e){
		if (e.key === 'Escape') OverlayHistory.closeTop();
	});

	/* ============================================================
	   HEADER — shadow on scroll, and auto-hide on touchscreens
	   ------------------------------------------------------------
	   Item 1: on touch devices the header slides away on scroll-down
	   and returns on scroll-up. This matters most in landscape: the
	   larger iPhones are 861-1023px wide when turned sideways, which
	   is the band where the nav takes a row of its own and the header
	   stands ~96px tall — a sizeable share of a viewport only a few
	   hundred pixels high.

	   One scroll listener drives both the shadow and the auto-hide,
	   throttled to a single animation frame, so scrolling costs one
	   handler rather than two and does no layout work per event.
	============================================================ */
	if (header) {
		var JITTER = 6;        /* px of movement to ignore (finger wobble) */
		var lastY = 0;         /* last scroll position we acted on         */
		var frameQueued = false;
		var headerH = header.offsetHeight;
		var holdUntil = 0;     /* timestamp until which hiding is paused */
		var finePointer = window.matchMedia(POINTER_FINE);

		function showHeader(){ header.classList.remove('is-hidden'); }

		function updateHeader(){
			frameQueued = false;
			var y = window.pageYOffset;

			/* iOS rubber-banding reports positions past both ends of
			   the document. Left unclamped, the bounce at the bottom of
			   a page reads as "scrolled up" and pops the header open
			   for no reason; the same happens at the top. */
			var maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
			if (y < 0) y = 0;
			else if (y > maxY) y = maxY;

			header.classList.toggle('is-scrolled', y > 8);

			/* A jump to an anchor scrolls a long way down at once,
			   which would otherwise read as "the visitor is scrolling
			   down" and hide the bar mid-jump — while the page is
			   still reserving room for it (html{scroll-padding-top}),
			   leaving a gap above the section jumped to. So the header
			   is held still until the jump has settled. lastY is kept
			   in step meanwhile, so the end of the jump isn't seen as
			   one huge downward movement the moment the hold lifts. */
			if (Date.now() < holdUntil) {
				lastY = y;
				showHeader();
				return;
			}

			/* Ignore movement too small to be a deliberate scroll.
			   lastY is deliberately NOT updated here, so a slow drag
			   still accumulates until it crosses the threshold. */
			var moved = y - lastY;
			if (Math.abs(moved) < JITTER) return;
			lastY = y;

			/* Hide only when: this is a touchscreen, the menu is shut,
			   we are past the header's own height (so it never hides
			   while the page is still at the top), and the movement was
			   downwards. Anything else brings it back.

			   The menu check matters because the panel hangs off the
			   header — hiding the bar with the menu open would take the
			   menu with it, mid-use. */
			if (!finePointer.matches && !navIsOpen() && y > headerH && moved > 0) {
				header.classList.add('is-hidden');
			} else {
				showHeader();
			}
		}

		function queueHeaderUpdate(){
			if (frameQueued) return;
			frameQueued = true;
			window.requestAnimationFrame(updateHeader);
		}

		/* The header's height changes with the viewport (the nav moves
		   onto its own row between 861px and 1023px), so it is measured
		   once and re-measured only when something could have changed
		   it — never inside the scroll handler. */
		function remeasureHeader(){
			headerH = header.offsetHeight;
			queueHeaderUpdate();
		}

		lastY = window.pageYOffset;
		queueHeaderUpdate();
		window.addEventListener('scroll', queueHeaderUpdate, {passive:true});
		window.addEventListener('resize', remeasureHeader, {passive:true});

		/* If a mouse or keyboard appears (an iPad with a trackpad
		   attached, or the devtools device emulator being switched
		   off), stop hiding and show the bar again immediately. */
		onMediaChange(finePointer, function(){
			if (finePointer.matches) showHeader();
		});

		/* Every in-page jump link on the site (the nav, the hero CTAs)
		   changes the hash, so this is the one place that needs to know
		   a jump has started. 700ms comfortably covers the smooth
		   scroll; if the visitor scrolls by hand before it elapses,
		   nothing is broken — the header simply stays put a moment
		   longer than usual. */
		window.addEventListener('hashchange', function(){
			holdUntil = Date.now() + 700;
			showHeader();
		});

		/* Tabbing into the header must never land focus on something
		   that has slid off the top of the screen. */
		header.addEventListener('focusin', showHeader);

		/* Web fonts load with font-display:swap, so the bar can change
		   height slightly once the real font arrives. */
		if (document.fonts && document.fonts.ready) {
			document.fonts.ready.then(remeasureHeader);
		}
	}

	/* ============================================================
	   MOBILE NAV
	============================================================ */
	if (navToggle && siteNav) {
		/* The menu expressed as an overlay for OverlayHistory above:
		   close() only touches the DOM, never history. */
		var navOverlay = {
			close: function(){
				siteNav.classList.remove('is-open');
				navToggle.setAttribute('aria-expanded', 'false');
				/* If focus was inside the menu as it closed, move it
				   somewhere still on screen. */
				if (siteNav.contains(document.activeElement)) navToggle.focus();
			}
		};

		navToggle.addEventListener('click', function(){
			if (navIsOpen()) {
				OverlayHistory.close(navOverlay);
			} else {
				siteNav.classList.add('is-open');
				navToggle.setAttribute('aria-expanded', 'true');
				OverlayHistory.open(navOverlay);
			}
		});

		/* Item 4 in practice: while the menu is open it owns a history
		   entry, and letting a link navigate normally would stack a
		   second entry on top of it. Back would then step onto our
		   leftover entry — the same page, menu shut — before it ever
		   left the page, which is exactly the confusion this round set
		   out to remove.

		   location.replace() overwrites our entry with the destination
		   instead of adding to it, so the history ends up precisely as
		   it would have been had the menu never been opened. That holds
		   for both kinds of link in this menu: a same-page anchor on the
		   homepage, and a full URL back to the homepage from the other
		   pages. Modifier-clicks (open in a new tab, and the like) are
		   left alone for the browser to handle. */
		siteNav.querySelectorAll('a').forEach(function(a){
			a.addEventListener('click', function(e){
				if (!navIsOpen()) return;  /* wide-screen nav: nothing to close */
				if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
				e.preventDefault();
				OverlayHistory.discard(navOverlay);
				window.location.replace(a.href);
			});
		});

		/* A tap or click anywhere outside the open menu closes it. The
		   toggle is excluded so this doesn't fight its own handler. */
		document.addEventListener('click', function(e){
			if (!navIsOpen()) return;
			if (siteNav.contains(e.target) || navToggle.contains(e.target)) return;
			OverlayHistory.close(navOverlay);
		});
	}

	/* ============================================================
	   SCROLL REVEAL
	============================================================ */
	var revealEls = document.querySelectorAll('.reveal');
	if (revealEls.length) {
		var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reduceMotion || !('IntersectionObserver' in window)) {
			revealEls.forEach(function(el){ el.classList.add('is-visible'); });
		} else {
			var io = new IntersectionObserver(function(entries){
				entries.forEach(function(entry){
					if (entry.isIntersecting) {
						entry.target.classList.add('is-visible');
						io.unobserve(entry.target);
					}
				});
			}, {threshold:0.12});
			revealEls.forEach(function(el){ io.observe(el); });
		}
	}

	/* ============================================================
	   LIGHTBOX
	   Any element with class "enlarge" and a data-full (plus optional
	   data-alt) attribute opens the #lightbox element, if the page
	   includes one. Back-button handling comes from OverlayHistory.
	============================================================ */
	var lightbox = document.getElementById('lightbox');
	if (lightbox) {
		var lightboxImg = document.getElementById('lightboxImg');
		var lightboxClose = document.getElementById('lightboxClose');

		var lightboxOverlay = {
			close: function(){
				lightbox.classList.remove('is-open');
				lightbox.setAttribute('aria-hidden', 'true');
				lightboxImg.src = '';
			}
		};

		document.querySelectorAll('.enlarge').forEach(function(el){
			el.addEventListener('click', function(){
				lightboxImg.src = el.dataset.full;
				lightboxImg.alt = el.dataset.alt || '';
				lightbox.classList.add('is-open');
				lightbox.setAttribute('aria-hidden', 'false');
				OverlayHistory.open(lightboxOverlay);
			});
		});

		if (lightboxClose) {
			lightboxClose.addEventListener('click', function(){
				OverlayHistory.close(lightboxOverlay);
			});
		}
		lightbox.addEventListener('click', function(e){
			if (e.target === lightbox) OverlayHistory.close(lightboxOverlay);
		});
	}

})();
