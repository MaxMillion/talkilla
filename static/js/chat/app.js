/*global jQuery, Backbone, _, tnetbin, WebRTC*/
/* jshint unused: false */
/**
 * Talkilla application.
 */
var ChatApp = (function($, Backbone, _) {
  "use strict";

  /**
   * Application object
   * @type {Object}
   */
  var app = window.app = {
    // default options
    options: {},

    // app modules
    data: {},
    models: {},
    port: {},
    media: {},
    views: {},
    utils: {},

    start: function(options) {
      _.extend(this.options, options || {});
    }
  };

  function ChatApp() {
    this.port = app.port;
    // XXX app.data.user probably shouldn't be global, but this is synced
    // with the sidebar so needs to be reworked at the same time.
    app.data.user = new app.models.User();
    this.peer = new app.models.User();

    this.webrtc = new WebRTC({
      iceServers: app.options && app.options.iceServers,
      forceFake: !!(app.options && app.options.FAKE_MEDIA_STREAMS)
    });

    this.webrtc.on("error", function(message) {
      // XXX: notify user that something went wrong
      console.error(message);
    });

    this.call = new app.models.Call({}, {
      media: this.webrtc,
      peer: this.peer
    });

    this.callControlsView = new app.views.CallControlsView({
      call: this.call,
      el: $("#call-controls")
    });

    this.callView = new app.views.CallView({
      call: this.call,
      el: $("#call")
    });

    this.callOfferView = new app.views.CallOfferView({
      call: this.call,
      el: $("#offer")
    });

    this.callEstablishView = new app.views.CallEstablishView({
      model: this.call,
      peer: this.peer,
      el: $("#establish")
    });

    // Audio library
    this.audioLibrary = new app.utils.AudioLibrary({
      incoming: "/snd/incoming_call_ring.opus",
      outgoing: "/snd/outgoing_call_ring.opus"
    });

    // Text chat
    // TODO: prefill the chat with history
    var history = [];

    this.textChat = new app.models.TextChat(history, {
      media: this.webrtc,
      peer: this.peer
    });

    this.textChatView = new app.views.TextChatView({
      collection: this.textChat,
      sender: app.data.user
    });

    this.view = new app.views.ConversationView({
      call: this.call,
      textChat: this.textChat,
      peer: this.peer,
      el: 'body'
    });

    // Incoming events
    this.port.on('talkilla.conversation-open',
                 this._onConversationOpen.bind(this));
    this.port.on('talkilla.conversation-incoming',
                 this._onIncomingConversation.bind(this));
    this.port.on('talkilla.call-establishment',
                 this._onCallEstablishment.bind(this));
    this.port.on('talkilla.call-upgrade', this._onCallUpgrade.bind(this));
    this.port.on('talkilla.call-hangup', this._onCallShutdown.bind(this));

    // Outgoing events
    this.call.on('send-offer', this._onSendOffer.bind(this));
    this.textChat.on('send-offer', this._onSendOffer.bind(this));
    this.call.on('send-answer', this._onSendAnswer.bind(this));
    this.textChat.on('send-answer', this._onSendAnswer.bind(this));

    this.call.on('offer-timeout', this._onCallOfferTimout.bind(this));

    // Internal events
    this.call.on('state:accept', this._onCallAccepted.bind(this));

    // Internal events
    window.addEventListener("unload", this._onCallHangup.bind(this));

    this.port.postEvent('talkilla.chat-window-ready', {});

    this._setupDebugLogging();
  }

  // Outgoing calls
  ChatApp.prototype._onConversationOpen = function(data) {
    this.peer.set({nick: data.peer});
  };

  ChatApp.prototype._onCallAccepted = function() {
    this.audioLibrary.stop('incoming');
  };

  ChatApp.prototype._onCallEstablishment = function(data) {
    // text chat conversation
    if (data.textChat)
      return this.textChat.establish(data.answer);

    // video/audio call
    this.call.establish(data);
  };

  ChatApp.prototype._onCallOfferTimout = function(callData) {
    this.port.postEvent('talkilla.offer-timeout', callData);
    this.audioLibrary.stop('outgoing');
  };

  // Incoming calls
  ChatApp.prototype._onIncomingConversation = function(data) {
    this.peer.set({nick: data.peer});

    var options = _.extend(WebRTC.parseOfferConstraints(data.offer), {
      offer: data.offer,
      textChat: !!data.textChat,
      upgrade: !!data.upgrade
    });

    // incoming text chat conversation
    if (data.textChat)
      return this.textChat.answer(options.offer);

    // incoming video/audio call
    this.call.incoming(options);
    this.audioLibrary.play('incoming');
  };

  ChatApp.prototype._onSendOffer = function(data) {
    this.port.postEvent('talkilla.call-offer', data);
    if (!data.textChat)
      this.audioLibrary.play('outgoing');
  };

  ChatApp.prototype._onSendAnswer = function(data) {
    this.port.postEvent('talkilla.call-answer', data);
  };

  ChatApp.prototype._onCallUpgrade = function(data) {
    var sdp = data.offer.sdp;

    var options = {
      video: sdp.contains("\nm=video "),
      audio: sdp.contains("\nm=audio "),
      offer: data.offer,
      textChat: !!data.textChat,
      upgrade: !!data.upgrade
    };

    this.call.incoming(options);
    // XXX: call upgrades should probably be accepted manually
    this.call.accept();
  };

  // Call Hangup
  ChatApp.prototype._onCallShutdown = function() {
    this.audioLibrary.stop('incoming', 'outgoing');
    this.call.hangup();
    window.close();
  };

  ChatApp.prototype._onCallHangup = function(data) {
    var callState = this.call.state.current;
    if (callState === "ready" || callState === "terminated")
      return;

    this.call.hangup();

    this.port.postEvent('talkilla.call-hangup', {
      peer: this.peer.get("nick")
    });
  };

  // if debug is enabled, verbosely log object events to the console
  ChatApp.prototype._setupDebugLogging = function() {
    if (!app.options.DEBUG)
      return;

    // app object events logging
    ['webrtc', 'call', 'textChat'].forEach(function(prop) {
      this[prop].on("all", function() {
        var args = [].slice.call(arguments);
        console.log.apply(console, ['chatapp.' + prop].concat(args));
      });
    }, this);
  };

  return ChatApp;
})(jQuery, Backbone, _);
