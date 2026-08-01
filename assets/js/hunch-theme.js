/* ============================================================
   THE HUNCH TRAIL — SHARED BEHAVIOUR
   Footer year, sticky header shadow, mobile nav toggle, scroll
   reveal, and a generic lightbox. Safe to include on every page
   — each piece checks the DOM before it does anything, so pages
   without a given element (e.g. no .enlarge triggers) just skip
   that part.
============================================================ */
(function(){
	"use strict";

	/* Footer year */
	var yearEl = document.getElementById('thisYear');
	if (yearEl) yearEl.textContent = new Date().getFullYear();

	/* Sticky header shadow */
	var header = document.getElementById('header');
	if (header) {
		window.addEventListener('scroll', function(){
			header.classList.toggle('is-scrolled', window.scrollY > 8);
		}, {passive:true});
	}

	/* Mobile nav toggle */
	var navToggle = document.getElementById('navToggle');
	var siteNav = document.getElementById('siteNav');
	if (navToggle && siteNav) {
		function closeNav(){
			siteNav.classList.remove('is-open');
			navToggle.setAttribute('aria-expanded', 'false');
		}
		navToggle.addEventListener('click', function(){
			var open = siteNav.classList.toggle('is-open');
			navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
		});
		siteNav.querySelectorAll('a').forEach(function(a){
			a.addEventListener('click', closeNav);
		});
		/* Item 2: previously the only way to dismiss an open menu with
		   no selection was to re-tap the toggle button itself. A tap or
		   click anywhere outside the open menu (and outside the toggle,
		   so the toggle's own click handler above isn't fought with)
		   now closes it too. */
		document.addEventListener('click', function(e){
			if (!siteNav.classList.contains('is-open')) return;
			if (siteNav.contains(e.target) || navToggle.contains(e.target)) return;
			closeNav();
		});
		/* Item 2: same dismissal via the keyboard Escape key. */
		document.addEventListener('keydown', function(e){
			if (e.key === 'Escape' && siteNav.classList.contains('is-open')) {
				closeNav();
				navToggle.focus();
			}
		});
	}

	/* Scroll reveal */
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

	/* Generic lightbox — any element with class "enlarge" and a
	   data-full (and optional data-alt) attribute will open the
	   #lightbox element, if the page includes one.

	   The mobile back button fires a 'popstate' event rather than a
	   click, so a plain show/hide would leave the back button free to
	   navigate the browser away from the page while the modal is open.
	   To stop that, opening the modal pushes a history entry; the back
	   button then just pops that entry (closing the modal) instead of
	   leaving the page. Closing the modal any other way (X, backdrop,
	   Escape) calls history.back() itself to remove that same entry,
	   so the history stack never grows and a second back press behaves
	   normally. */
	var lightbox = document.getElementById('lightbox');
	if (lightbox) {
		var lightboxImg = document.getElementById('lightboxImg');
		var lightboxClose = document.getElementById('lightboxClose');
		var lightboxOpen = false;

		function openLightbox(src, alt){
			lightboxImg.src = src;
			lightboxImg.alt = alt || '';
			lightbox.classList.add('is-open');
			lightbox.setAttribute('aria-hidden', 'false');
			lightboxOpen = true;
			history.pushState({hunchLightboxOpen:true}, '');
		}
		function closeLightbox(fromPopState){
			if (!lightboxOpen) return;
			lightboxOpen = false;
			lightbox.classList.remove('is-open');
			lightbox.setAttribute('aria-hidden', 'true');
			lightboxImg.src = '';
			if (!fromPopState) history.back();
		}
		document.querySelectorAll('.enlarge').forEach(function(el){
			el.addEventListener('click', function(){
				openLightbox(el.dataset.full, el.dataset.alt);
			});
		});
		if (lightboxClose) lightboxClose.addEventListener('click', function(){ closeLightbox(false); });
		lightbox.addEventListener('click', function(e){
			if (e.target === lightbox) closeLightbox(false);
		});
		document.addEventListener('keydown', function(e){
			if (e.key === 'Escape') closeLightbox(false);
		});
		window.addEventListener('popstate', function(){
			if (lightboxOpen) closeLightbox(true);
		});
	}

})();
