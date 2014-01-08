/*global app, sidebarApp */
/**
 * Talkilla Backbone views.
 */
(function(app, Backbone, _) {
  "use strict";

  /**
   * Global app view.
   */
  app.views.AppView = app.views.BaseView.extend({
    el: 'body',

    initialize: function(options) {
      options = this.checkOptions(options, "user", "users", "appStatus", "spa");

      this.login = new app.views.LoginView({
        appStatus: options.appStatus,
        user: options.user
      });

      this.users = new app.views.UsersView({
        user: options.user,
        collection: options && options.users,
        appStatus: options.appStatus
      });

      this.importButton = new app.views.ImportContactsView({
        user: options.user,
        service: options.services && options.services.google
      });

      this.spa = new app.views.SPAView({
        user: options.user,
        spa: options.spa
      });

      this.notifications = new app.views.NotificationsView({
        user: options.user,
        appStatus: options.appStatus
      });
    },

    render: function() {
      this.login.render();
      this.users.render();
      this.importButton.render();
      this.spa.render();
      return this;
    }
  });

  /**
   * SPA view.
   */
  app.views.SPAView = app.views.BaseView.extend({
    el: "#pstn-dialin",

    events: {
      "submit form": "dial"
    },

    initialize: function(options) {
      options = this.checkOptions(options, "user", "spa");

      // true if we are attempting a reconnection.
      this.reconnecting = false;

      // Date when we first tried to reconnect.
      this.firstReconnection = undefined;

      this.spa = options.spa.on("change:capabilities", this.render, this);
      this.user = options.user.on('signin signout', this.render, this);
    },

    dial: function(event) {
      event.preventDefault();

      this.spa.dial(event.currentTarget.number.value);
    },

    display: function(show) {
      if (show)
        this.$el.removeClass("hide");
      else
        this.$el.addClass("hide");
    },

    render: function() {
      this.display(this.user.isLoggedIn() && this.spa.supports("pstn-call"));
    }
  });

  /**
   * Notifications list view.
   */
  app.views.NotificationsView = app.views.BaseView.extend({
    el: '#messages',

    notifications: [],

    initialize: function(options) {
      options = this.checkOptions(options, "user", "appStatus");
      this.user = options.user;
      this.appStatus = options.appStatus;

      this.user.on('signin signout', this.clear, this);
      this.appStatus.on('reconnecting', this.notifyReconnection, this);
    },

    notifyReconnection: function(event) {
      console.log("notifyReconnection called", event);
      var timeout = event.timeout / 1000;
      app.utils.notifyUI("We lost the connection with the server. " +
                         "Attempting a reconnection in " + timeout + "s...",
                         "error", event.timeout);
      // XXX Here we clear all the notifications but we only want to clear
      // the reconnection ones. Adding a filtering mechanism to the notifs
      // could solve the problem.
      this.clear();
    },

    /**
     * Adds a new notification.
     * @param {app.views.NotificationView} notification
     */
    addNotification: function(notification) {
      var el = notification.render().el;

      this.notifications.push(notification);
      this.$el.append(el);

      // Clear the notification once the timeout reached.
      if (notification.model.has("timeout")) {
        setTimeout(notification.clear.bind(notification),
                   notification.model.get("timeout"));
      }

      return this;
    },

    /**
     * Clear current active notification if any and empty the notifications
     * list.
     */
    clear: function() {
      if (this.notification) {
        this.notification.clear();
        this.notification = undefined;
      }
      this.$el.html('');
    }
  });

  /**
   * User list entry view.
   */
  app.views.UserEntryView = app.views.BaseView.extend({
    tagName: 'li',

    template: _.template([
      '<a href="#" rel="<%= nick %>">',
      '  <div class="avatar">',
      '    <img src="<%= avatar %>">',
      '    <span class="status status-<%= presence %>"></span>',
      '  </div>',
      '  <span class="username"><%= nick %></span>',
      '</a>'
    ].join('')),

    events: {
      'click a': 'openConversation'
    },

    initialize: function(options) {
      this.model = options && options.model;
      this.active = options && options.active;
    },

    openConversation: function(event) {
      event.preventDefault();
      // XXX: we shouldn't be calling the app directly here
      sidebarApp.openConversation(event.currentTarget.getAttribute('rel'));
    },

    render: function() {
      this.$el.html(this.template(this.model.toJSON()));
      if (this.active)
        this.$('a').addClass('active');
      return this;
    }
  });

  /**
   * User list view.
   */
  app.views.UsersView = app.views.BaseView.extend({
    el: '#users',

    views: [],
    activeNotification: null,

    initialize: function(options) {
      options = this.checkOptions(options, "user", "collection", "appStatus");

      this.user = options.user;
      this.collection.on('reset change', this.render, this);
      options.appStatus.on("reconnecting",
        this.updateUsersPresence.bind(this, "disconnected"));
    },

    /**
     * Initializes all user entry items with every online user records except
     * the one of currently logged in user, if any.
     */
    initViews: function() {
      if (!this.collection)
        return;
      var callee = this.callee;
      var session = this.user;
      this.views = [];
      this.collection.chain().reject(function(user) {
        // filter out current signed in user, if any
        if (!session.isLoggedIn())
          return false;
        return user.get('nick') === session.get('nick');
      }).each(function(user) {
        // create a dedicated list entry for each user
        this.views.push(new app.views.UserEntryView({
          model:  user,
          active: !!(callee &&
                     callee.get('nick') === user.get('nick'))
        }));
      }.bind(this));
    },

    updateUsersPresence: function(status) {
      // Show all the users as disconnected.
      this.collection.each(function(user) {
        user.set("presence", status);
      });
    },

    render: function() {
      this.initViews();
      // remove user entries
      this.$('li:not(.nav-header)').remove();
      if (!this.collection)
        return this;
      // render all subviews
      var userList = _.chain(this.views).map(function(view) {
        return view.render();
      }).pluck('el').value();
      this.$('ul').append(userList);
      // show/hide element regarding auth status
      if (this.user.isLoggedIn())
        this.$el.show();
      else
        this.$el.hide();
      // show/hide invite if user is alone
      if (this.user.isLoggedIn() && this.collection.length === 1) {
        if (!this.activeNotification)
          this.activeNotification =
            app.utils.notifyUI('You are the only person logged in, ' +
                                'invite your friends or load your existing ' +
                                'contacts (see below).', 'info');
      }
      else {
        if (this.activeNotification)
          this.activeNotification.clear();
        this.activeNotification = null;
      }
      return this;
    }
  });

  /**
   * Login/logout forms view.
   */
  app.views.LoginView = app.views.BaseView.extend({
    el: '#login',

    events: {
      'submit form#signout': 'signout'
    },

    initialize: function(options) {
      options = this.checkOptions(options, "user", "appStatus");

      this.user = options.user;
      this.appStatus = options.appStatus;

      this.user.on('change', this.render, this);
      this.appStatus.on('change:workerInitialized', this.render, this);
    },

    render: function() {
      if (!this.appStatus.get('workerInitialized')) {
        this.$('#signout').hide();
        this.$('[name="spa-setup"]').remove();
      } else if (!this.user.get("nick")) {
        var iframe = $("<iframe>")
          .attr("src", "/talkilla-spa-setup.html")
          .attr("id", "signin")
          .attr("name", "spa-setup");
        $("#login p:first").append(iframe);

        this.$('#signout').hide().find('.nick').text('');
      } else {
        this.$('#signin').hide();
        this.$('[name="spa-setup"]').remove();
        this.$('#signout').show().find('.nick').text(this.user.get('nick'));
      }
      return this;
    },

    /**
     * Signs out a user.
     *
     * @param  {FormEvent}  Signout form submit event
     */
    signout: function(event) {
      event.preventDefault();
      this.user.signout();
    }
  });

  app.views.ImportContactsView = app.views.BaseView.extend({
    el: "#import-contacts",

    events: {
      "click button": 'loadGoogleContacts'
    },

    initialize: function(options) {
      options = this.checkOptions(options, "user", "service");

      this.user = options.user;
      this.service = options.service;

      this.user.on('signin signout', this.render, this);
    },

    loadGoogleContacts: function() {
      this.service.loadContacts();
    },

    render: function() {
      if (this.user.isLoggedIn())
        this.$el.show();
      else
        this.$el.hide();
      return this;
    }
  });
})(app, Backbone, _);
