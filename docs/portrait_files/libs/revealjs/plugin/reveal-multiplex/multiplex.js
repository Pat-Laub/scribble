// reveal.js multiplexing, driven by what this *device* was told to be rather
// than by the URL: multiplex-login.html on the course site stores a role and a
// token in localStorage, and every deck on that origin then picks them up. So
// the presenting iPad and the projector Mac each open the ordinary deck link and
// are already in the right role, with no ids or secrets to carry around.
//
// With no role stored this contacts no server at all, which is how the published
// decks stay ordinary. It does still talk on a BroadcastChannel, which reaches
// no further than this browser's own windows: open the same deck twice and the
// two follow each other with no relay in between and nothing to sign in to.
window.RevealMultiplex = {
	id: 'multiplex',

	// Consumers may supply their relay as Reveal's `multiplexRelay.server`
	// setting. Not `multiplex`: Quarto reserves that key, and switches its own
	// bundled multiplex plugin on for any deck that sets it, which then opens a
	// socket to a public relay of its own.
	// The public extension is otherwise inert rather than assuming a server.
	server: null,

	init: function ( deck ) {
		// The speaker view holds two more copies of this deck in iframes of the
		// same origin -- one of them showing the *next* slide. Left to talk, the
		// upcoming one would tell every window to move on, and the deck would walk
		// itself through to the end.
		if ( window.top !== window.self || /receiver/i.test( location.search ) ) return;

		// A stray device left on last week's deck would otherwise apply this
		// deck's slide indices to different content and look plausible doing it,
		// so every message carries the path it came from.
		var path = location.pathname;

		var EVENTS = [ 'slidechanged', 'fragmentshown', 'fragmenthidden', 'overviewshown',
			'overviewhidden', 'paused', 'resumed' ];

		/* ------------------------------ the role ------------------------------ */
		// One pair of words covers both transports below: a presenter drives, an
		// audience follows, and a follower puts nothing out on either of them.
		//
		// The course site hands a staff session its credentials in the page
		// itself, on `?present` or `?project`: no login page, no 180-day token
		// sitting in a browser, and nothing to have set up on the right device
		// beforehand. The localStorage pair is the older path and still works,
		// which is what keeps the published decks and the login page usable until
		// the new site is the only way in.
		//
		// `?project` is the site's word for the screen being watched, and it means
		// the same typed by hand on a deck this device has no credentials for:
		// that window follows and puts nothing out. Signed in, it follows the
		// relay too, which is the projector in the theatre; otherwise it follows
		// the windows beside it, which is a second window of this browser dragged
		// onto a monitor -- the channel reaches it there, and there is nothing to
		// sign in to.
		var projected = false;
		try { projected = new URLSearchParams( location.search ).has( 'project' ); } catch ( e ) {}

		var handed = window.__multiplex || {};
		var role = handed.role, token = handed.token;
		if ( !role || !token ) {
			try {
				role = localStorage.getItem( 'multiplex-role' );
				token = localStorage.getItem( 'multiplex-token' );
			} catch ( e ) {}              // storage blocked: behave as an ordinary deck
		}
		if ( ( role !== 'presenter' && role !== 'audience' ) || !token ) {
			role = null;
			token = null;
		}
		if ( projected && role !== 'audience' ) {
			role = 'audience';
			token = null;                 // this window was not signed in as one
		}

		// The audience view's bare chrome: this screen is being watched rather
		// than written on, whichever way it was told so.
		if ( role === 'audience' ) document.documentElement.classList.add( 'multiplex-audience' );

		// Annotate and Display are the same deck with the same chrome, and the
		// only way to tell them apart is to draw on one. On the iPad that makes
		// a Display window indistinguishable from a Pencil that has stopped
		// working. Each window says what it is as it opens and then goes away
		// again: a projected screen is not to carry a permanent caption.
		if ( role ) sayMode( role === 'presenter' ? 'Annotate \u2014 you are presenting'
			: 'Display \u2014 following the presenter' );

		// Whether a message about the wrong deck is worth saying out loud. On a
		// projected screen it is; on someone's second tab it would only be a
		// caption appearing every time they moved in the first one.
		var announce = role === 'audience';

		/* ----------------------- the window next to this one ------------------ */
		// Two windows of the same deck in one browser -- one of them dragged onto an
		// external monitor -- need no relay between them: BroadcastChannel carries
		// the same messages straight across, same origin, same device. A deck with
		// no role given to it both talks and listens, so whichever one you touch is
		// the one that leads and there is nothing to set up or remember.

		// Set while a message off the channel is being applied, because applying one
		// moves this deck, and moving this deck is what sends messages. Without it a
		// slide change comes back as an echo a moment after the next one, and the
		// two windows walk backwards over each other.
		var applying = false;

		var channel = null;
		try { if ( window.BroadcastChannel ) channel = new BroadcastChannel( 'reveal-multiplex' ); } catch ( e ) {}

		if ( channel ) {
			// Costs nothing when nothing is listening: postMessage into a channel with
			// no other window on it is a few hundred bytes dropped on the floor, which
			// is cheaper than keeping track of whether a second window exists.
			var broadcast = function ( evt ) {
				if ( applying ) return;
				channel.postMessage( { state: deck.getState(), path: path, content: ( evt || {} ).content } );
			};

			channel.onmessage = function ( e ) {
				if ( !e.data ) return;
				if ( e.data.sync ) {
					if ( role === 'audience' ) return;   // a follower has nothing of its own to answer with
					document.dispatchEvent( new CustomEvent( 'welcome' ) );
					broadcast();
					return;
				}
				applying = true;
				try { apply( e.data, true ); } finally { applying = false; }
			};

			// A window that has just opened asks rather than tells: it adopts the
			// slide and the ink the others are showing, instead of dragging them all
			// back to whatever it happened to load on. Asked again by annotate.js
			// once that has a listener up, since the first answer arrives early.
			var hello = function () { channel.postMessage( { sync: true } ); };
			hello();
			document.addEventListener( 'rejoin', hello );

			if ( role !== 'audience' ) {
				EVENTS.forEach( function ( name ) { deck.on( name, broadcast ); } );
				document.addEventListener( 'send', broadcast );
			}
		}

		/* -------------------- browsing away from the presenter ---------------- */
		// A window that is only watching still has a reason to look back a
		// slide, and being dragged forward again by the next message is worse
		// than not moving at all. One moved by hand stops following, says so,
		// and keeps the way back one tap away -- which is also what an iPad
		// accidentally opened in Display mode looks like: the first swipe
		// announces it rather than silently doing nothing.
		//
		// Only the slide is held back. Ink keeps arriving and is drawn on the
		// slide it was made on, so returning live finds the deck written up to
		// date rather than replaying the interval.
		var detached = false, missed = null, chip = null;

		if ( role === 'audience' ) deck.on( 'ready', function () {
			deck.on( 'slidechanged', function () { if ( !applying ) detach(); } );
		} );

		function detach() {
			if ( detached ) return;
			detached = true;
			if ( !chip ) {
				chip = document.createElement( 'div' );
				chip.className = 'multiplex-detached';
				chip.textContent = 'Not following presenter';
				var back = document.createElement( 'button' );
				back.type = 'button';
				back.textContent = 'Return live';
				back.addEventListener( 'click', follow );
				chip.appendChild( back );
				document.body.appendChild( chip );
			}
			chip.hidden = false;
		}

		function follow() {
			detached = false;
			if ( chip ) chip.hidden = true;
			place( missed );
			missed = null;
			// Nothing was missed if the presenter has not moved since, and this
			// window is then sitting on a slide it chose by hand: ask.
			document.dispatchEvent( new CustomEvent( 'rejoin' ) );
		}

		/* ----------------------------- the relay ------------------------------ */

		if ( !token ) return;                 // nothing to sign in with: this deck talks to its own browser and no further

		var debug = false;
		try { debug = !!localStorage.getItem( 'multiplex-debug' ); } catch ( e ) {}

		var config = deck.getConfig().multiplexRelay || {};
		var server = handed.server || config.server || window.RevealMultiplex.server;
		if ( !server ) return;
		var socket = io.connect( server, {
			query: { token: token, role: role },
			transports: [ 'websocket', 'polling' ]
		} );

		socket.on( 'error', function ( err ) {
			// The token was rejected (expired, or the password has changed).
			if ( String( err ).indexOf( 'unauthorized' ) >= 0 ) notice( 'Multiplex sign-in expired' );
		} );

		if ( role === 'presenter' ) {
			var post = function ( evt ) {
				if ( applying ) return;   // the window this came from has already sent it
				socket.emit( 'state', {
					state: deck.getState(),
					path: path,
					content: ( evt || {} ).content
				} );
			};

			EVENTS.forEach( function ( name ) { deck.on( name, post ); } );
			// Custom events broadcast by the rest of the deck (annotate.js).
			document.addEventListener( 'send', post );

			if ( document.readyState === 'complete' ) post();
			else window.addEventListener( 'load', post );

			// An audience view that joined late has missed every event so far.
			// Resend the state, and let annotate.js resend the whole deck's ink:
			// its 'welcome' handler answers with a full-state message.
			socket.on( 'sync', function () {
				document.dispatchEvent( new CustomEvent( 'welcome' ) );
				post();
			} );

			// Latency readout, on the presenting device only (see probe() below).
			if ( debug ) probe( socket, post );

		} else {
			var ask = function () { socket.emit( 'sync' ); };
			socket.on( 'connect', ask );
			document.addEventListener( 'rejoin', ask );

			// Echo the presenter's latency probes back, so it can measure the round
			// trip. Deliberately NOT behind the debug flag: that flag belongs to
			// the device doing the measuring, and requiring it at both ends only
			// means a silent "latency …" that never resolves. Costs nothing when
			// nobody is probing -- the second socket is opened on the first probe
			// and not before. It declares itself a presenter because the relay
			// only forwards `state` from that role; this device holds a valid
			// token, so it is entitled to, and it sends nothing else on it.
			var echo = null;
			socket.on( 'state', function ( m ) {
				if ( !m || !m.probe || m.echo ) return;
				if ( !echo ) {
					echo = io.connect( server, {
						query: { token: token, role: 'presenter' },
						transports: [ 'websocket', 'polling' ]
					} );
				}
				echo.emit( 'state', { probe: m.probe, echo: true } );
			} );

			socket.on( 'state', function ( message ) { apply( message, false ); } );
		}

		/* ---------------------------- following ------------------------------- */
		// Shared by both transports, which differ only in how the message got
		// here: `local` says it came over the channel, and travelled no further
		// than this device.
		function apply( message, local ) {
			if ( !message ) return;
			if ( message.path && message.path !== path ) {
				if ( announce ) notice( 'Presenter is on ' + deckName( message.path ) );
				return;
			}
			clearNotice();
			if ( detached ) missed = message.state || missed;
			else place( message.state );
			if ( message.content ) {
				var event = new CustomEvent( 'received' );
				event.content = message.content;
				event.local = local;
				document.dispatchEvent( event );
			}
		}

		// Moving this deck is what sends messages and, on a window that is only
		// watching, what detaches it -- so every move made on this deck's
		// behalf goes through here, saying so while it happens. Saved and
		// restored rather than cleared: the channel already sets it around the
		// whole of apply().
		function place( state ) {
			if ( !state || !moved( state ) ) return;
			var was = applying;
			applying = true;
			try { deck.setState( state ); } finally { applying = was; }
		}

		// Whether that message is about a slide we are not on. Every ink packet
		// carries the slide it was drawn on, so a stroke sends one of these for
		// every sample the pen takes -- and deck.setState() is not free: reveal
		// rewrites the slide's classes, its fragments, the background and the
		// progress bar whether or not any of them changed. Measured at 5ms a call
		// on a laptop, which at a pen's sampling rate is the entire frame budget
		// spent arriving again on the slide we had not left, and the ink comes
		// through a long way behind the pen. Reading the state back costs nothing
		// by comparison, so ask before telling.
		//
		// Asking the deck rather than remembering what we last applied also means
		// a window that has been moved by hand is put back by the next message.
		function moved( state ) {
			var here = deck.getState();
			return state.indexh !== here.indexh || state.indexv !== here.indexv ||
				state.indexf !== here.indexf ||
				!!state.paused !== !!here.paused || !!state.overview !== !!here.overview;
		}

		/* --------------------------- latency readout --------------------------- */
		// How long the audience takes to see what you just did. Measured as a
		// round trip -- presenter to relay to audience, and back the same way --
		// so it needs no agreement between the two devices' clocks, which would
		// otherwise swamp a number this small. One way is about half of it.
		//
		// Shown only on the presenting device, and only when the login page's
		// "show latency" box is ticked: the audience screen is projected.
		function probe( socket, post ) {
			var pending = null, samples = [];

			var pill = document.createElement( 'div' );
			pill.style.cssText = 'position:fixed;left:8px;top:8px;z-index:60;padding:3px 9px;' +
				'border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font:12px/1.4 ui-monospace,monospace;' +
				'pointer-events:none;white-space:pre';
			pill.textContent = 'latency …';
			document.body.appendChild( pill );

			socket.on( 'state', function ( m ) {
				if ( !m || !m.echo || !pending || m.probe !== pending ) return;
				var rtt = Date.now() - pending;
				pending = null;
				samples.push( rtt );
				if ( samples.length > 20 ) samples.shift();

				var sorted = samples.slice().sort( function ( a, b ) { return a - b; } );
				var median = sorted[ Math.floor( sorted.length / 2 ) ];
				var worst = sorted[ sorted.length - 1 ];
				pill.textContent = 'one-way ~' + Math.round( median / 2 ) + 'ms' +
					'   (round trip ' + rtt + 'ms, median ' + median + ', worst ' + worst + ')';
			} );

			setInterval( function () {
				// Skip a beat rather than queue up when one goes unanswered.
				if ( pending && Date.now() - pending < 4000 ) return;
				pending = Date.now();
				socket.emit( 'state', { probe: pending } );
			}, 1000 );
		}

		/* ------------------------- the audience notice ------------------------- */
		// Deliberately small and quiet: this view is on a projector.

		function sayMode( text ) {
			var MODE_MS = 4000;   // long enough to read, short enough to miss
			var caption = document.createElement( 'div' );
			caption.className = 'multiplex-mode';
			caption.textContent = text;
			document.body.appendChild( caption );
			setTimeout( function () { caption.remove(); }, MODE_MS );
		}

		var box;
		function notice( text ) {
			if ( !box ) {
				box = document.createElement( 'div' );
				box.className = 'multiplex-notice';
				document.body.appendChild( box );
			}
			box.textContent = text;
			box.style.display = 'block';
		}
		function clearNotice() { if ( box ) box.style.display = 'none'; }
		function deckName( p ) {
			return decodeURIComponent( p.split( '/' ).pop() || '' ).replace( /\.slides\.html$/, '' );
		}
	}
};
