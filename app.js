'use strict';

const config = require('wild-config');
const log = require('npmlog');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const favicon = require('serve-favicon');
const logger = require('morgan');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);
const flash = require('connect-flash');
const compression = require('compression');
const passport = require('./lib/passport');
const db = require('./lib/db');

const routesIndex = require('./routes/index');
const routesAccount = require('./routes/account');
const routesWebmail = require('./routes/webmail');
const routesApi = require('./routes/api');

const app = express();

// setup extra hbs tags
require('./lib/hbs-helpers');

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

// Handle proxies. Needed to resolve client IP
if (config.www.proxy) {
    app.set('trust proxy', config.www.proxy);
}

// Do not expose software used
app.disable('x-powered-by');

app.use(compression());
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));

app.use(
    logger(config.www.log, {
        stream: {
            write: message => {
                message = (message || '').toString();
                if (message) {
                    log.info('HTTP', message.replace('\n', '').trim());
                }
            }
        }
    })
);

app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
    session({
        name: 'webmail',
        store: new RedisStore({
            client: db.redis.duplicate()
        }),
        secret: config.www.secret,
        saveUninitialized: false,
        resave: false,
        cookie: {
            secure: !!config.www.secure
        }
    })
);

app.use(flash());

app.use(
    bodyParser.urlencoded({
        extended: true,
        limit: config.www.postsize
    })
);

app.use(
    bodyParser.text({
        limit: config.www.postsize
    })
);

app.use(
    bodyParser.json({
        limit: config.www.postsize
    })
);

passport.setup(app);

app.use((req, res, next) => {
    // make sure flash messages are available
    res.locals.flash = req.flash.bind(req);
    res.locals.user = req.user;
    res.locals.allowJoin = config.service.allowJoin;
    res.locals.u2fEnabled = config.u2f.enabled;

    res.locals.serviceName = config.name;
    res.locals.serviceDomain = config.service.domain;

    next();
});

// force 2fa prompt if user is logged in and 2fa is enabled
app.use((req, res, next) => {
    if (
        req.user &&
        req.session.require2fa &&
        !['/account/logout', '/account/start-u2f', '/account/check-u2f', '/account/check-totp'].includes(req.url.split('?').shift())
    ) {
        return passport.csrf(req, res, err => {
            if (err) {
                return next(err);
            }

            return res.render('account/2fa', {
                layout: 'layout-popup',
                title: 'Two factor authentication',
                csrfToken: req.csrfToken(),
                enabled2fa: req.session.require2fa,
                enabledTotp: req.session.require2fa ? req.session.require2fa.includes('totp') : false,
                enabledU2f: req.session.require2fa && req.query.u2f !== 'false' ? req.session.require2fa.includes('u2f') : false,
                disableU2f: req.url + (req.url.indexOf('?') >= 0 ? '&' : '?') + 'u2f=false'
            });
        });
    }
    next();
});

// setup main routes
app.use('/', passport.csrf, routesIndex);
app.use('/account', passport.csrf, routesAccount);
app.use('/webmail', passport.csrf, passport.checkLogin, routesWebmail);
app.use('/api', passport.csrf, passport.checkLogin, routesApi);

// catch 404 and forward to error handler
app.use((req, res, next) => {
    let err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use((err, req, res, next) => {
        if (!err) {
            return next();
        }
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use((err, req, res, next) => {
    if (!err) {
        return next();
    }
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});

module.exports = app;
