require('dotenv').config();
const path = require('path');
// express requirements
const express = require('express');
const expressVue = require('express-vue');
const session = require('express-session');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const store = require('store');
// webpack requirements
const webpack = require('webpack');
const webpackConfig = require('./webpack.config.js');
const webpackMiddleware = require('webpack-dev-middleware');

const compiler = webpack(webpackConfig);
// database requirements
const passwordHash = require('password-hash');
const db = require('./db-config');

const { User, Event, Message } = db;
// passport requirements
const passport = require('passport');
const JsonStrategy = require('passport-json').Strategy;
const LocalStrategy = require('passport-local').Strategy;
// google maps requirement
const googleMapsClient = require('@google/maps').createClient({
  key: process.env.GOOGLE_MAPS_API_KEY,
});
// socket requirement
const socket = require('socket.io');

const app = express();

// webpack middleware
app.use(webpackMiddleware(compiler, {
  publicPath: webpackConfig.output.publicPath,
}));

// vue middleware
const vueOptions = {
  rootPath: path.join(__dirname, '/dist/'),
};
const expressVueMiddleWare = expressVue.init(vueOptions);
app.use(expressVueMiddleWare);
app.use(express.static(path.join(__dirname, '/dist/')));
app.use(express.static(__dirname));

// cross domain access
const allowCrossDomain = (req, res, next) => {
  res.header('Access-Control-Allow-Methods', 'POST, GET');
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Credentials', true);
  next();
};
app.use(allowCrossDomain);

// passport session setup
passport.serializeUser((user, done) => {
  console.log('serializing', user.dataValues.id || 'no user to serialize');
  // store.set(user.dataValues.id, { email: user.dataValues.email });
  done(null, user.id);
});
passport.deserializeUser((id, done) => {
  console.log('deserializing', id || 'no id to deserialize');
  User.findOne({ where: { id } }).then((user) => {
    console.log(user);
    done(null, user);
  }, (err) => {
    console.log(err);
    done(err);
  });
});

// passport strategy set-up
passport.use('json', new JsonStrategy({
  usernameProp: 'email',
  passwordProp: 'password',
  passReqToCallback: true,
}, (req, username, password, done) => {
  User.findOne({ where: { email: username } }).then((user) => {
    console.log('authenticating');
    if (!user) {
      console.log('no user');
      return done(null, false, { message: 'No user with that email in directory.' });
    }
    if (!passwordHash.verify(password, user.dataValues.Password)) {
      console.log(password, user);
      console.log('wrong password');
      return done(null, false, { message: 'Incorrect password!' });
    }

    console.log('passed authentication');
    return done(null, user);
  })
    .catch((err) => {
      console.log('error logging in:', err);
      return done(err);
    });
}));

passport.use('local', new LocalStrategy({
  usernameField: 'email',
}, (username, password, done) => {
  console.log('local authenticate', username);
  User.findOne({ email: username }, (err, user) => {
    if (err) {
      return done(err);
    }
    if (!user) {
      return done(null, false);
    }
    if (!passwordHash.verify(password, user.dataValues.Password)) {
      return done(null, false);
    }
    return done(null, user);
  });
}));

// parsers, passport session init
app.use(cookieParser('dinnertime'));
app.use(bodyParser.json({ extended: false }));
app.use(session({ secret: 'dinnertime', resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

// Routes:

app.get('/', (req, res) => {
  console.log('sent with app.get');
  res.sendFile(path.join(__dirname, '/index.html'));
});


app.get('/browse', (req, res) => {
  // IN PROGRESS
  Event.findAll().then((events) => {
    // console.log(events);
    res.status(200).send(events);
  });
});

app.post('/login', passport.authenticate('json', { failureRedirect: '/#/login' }), (req, res) => {
  // IN PROGRESS

  store.set(req.sessionID, { userID: req.user.dataValues.id });

  res.cookie('user', req.user.dataValues.id);

  res.status(201).send('successfully logged in');
});

app.get('/profile', (req, res) => {
  passport.authenticate('local');

  if (req.user) {
    User.findOne({ where: { id: req.user.dataValues.id } })
      .then((user) => {
        const dataToSend = {
          id: user.id,
          Name: user.Name,
          hostRating: user.Host_Rating,
          contributorRating: user.Contributor_Rating,
          Email: user.Email,
          City: user.City,
          memberSince: user.createdAt,
          Birthday: user.Birthday,
          Image: user.Image || null,
        };
        res.status(200).send(dataToSend);
      });
  } else {
    res.status(401).send('Go log in first!');
  }
});

app.post('/signup', (req, res) => {
  const hash = passwordHash.generate(req.body.password);
  // TEST password-hash

  User.findOrCreate({
    where: { Email: req.body.email },
    defaults: {
      Name: req.body.name,
      Host_Rating: 0,
      Contributor_Rating: 0,
      City: req.body.city,
      Password: hash,
      Birthday: req.body.dob,
      Image: req.body.Image || null,
    },
  })
    .spread((user, created) => {
      console.log(user.get({ plain: true }));
      console.log(created);
      if (created) {
        res.status(201).send('User successfully created');
      } else {
        res.status(200).send(user.get({ plain: true }));
      }
    });
});

app.post('/create', (req, res) => {
  passport.authenticate('local');
  // console.log(req.session, req.cookies.user);
  if (!req.cookies.user) {
    res.status(401).send('Need to log in first!');
  }
  let host;
  const {
    location, name, meal, time, date,
  } = req.body;
  User.findOne({ where: { id: parseInt(req.cookies.user) } }).then((user) => {
    host = user.Name;
    console.log('host:', host);
    // Calculate Latitude and Longitude, City, Zip from this address
    googleMapsClient.geocode({
      address: location,
    }, (err, response) => {
      console.log('mapped');
      if (err) {
        console.log(err);
      } else {
        const resultObj = response.json.results[0];
        const addressComponents = resultObj.address_components;
        // console.log(addressComponents);

        const latitude = resultObj.geometry.location.lat;
        const longitude = resultObj.geometry.location.lng;

        // console.log(name, meal, latitude, longitude, host);
        Event.create({
          Name: name,
          RecipeID: meal,
          LocationLat: latitude,
          LocationLng: longitude,
          Address: location,
          City: addressComponents[3].short_name,
          Zip_Code: addressComponents[7].short_name,
          Date: date,
          Time: time,
          Host: host,
        }).then(() => {
          Event.find({ where: { Name: name } }).then((event) => {
            res.status(201).send(event);
          }, (error) => {
            console.log('error creating event:', error);
            res.status(500).send('error creating event');
          });
        }, (error) => {
          console.log('error creating event:', error);
          res.status(500).send('Error creating event');
        });
      }
    });
  }, (userErr) => {
    console.log(userErr);
    res.status(500).send(userErr);
  });
});

app.get('/events', (req, res) => {
  Event.findAll().then((events) => {
    // console.log(events);
    res.status(200).send(events);
  });
});

app.get('/userevents', (req, res) => {
  console.log('/userevents', req.cookies.user);
  if (req.user) {
    const guestEvents = [];
    Event.findAll().then((events) => {
      events.forEach((event) => {
        if (event.Contributor_List.includes(req.user.dataValues.Name)) {
          guestEvents.push(event);
        }
      });
    }).then(() => {
      let hostName;
      User.findOne({ where: { id: parseInt(req.cookies.user) } }).then((user) => {
        hostName = user.Name;
        Event.findAll({ where: { host: hostName } }).then((events) => {
          console.log(events);

          res.status(200).send(events.concat(guestEvents));
        }, (err) => {
          console.log('error find userevents:', err);
          res.status(500).send(err);
        });
      });
    });
  } else {
    res.status(401).send('log in first');
  }
});

app.post('/request', (req, res) => {
  if (!req.user) {
    res.status(401).send('log in first!');
  } else {
    // console.log(req.body, req.user);
    const partyName = req.body.name;
    let host;
    const request = `${partyName}:${req.user.dataValues.Name}`;
    Event.findOne({ where: { Name: partyName } }).then((event) => {
      host = event.Host;
    })
      .then(() => {
        let currentNotifications;
        User.findOne({ where: { Name: host } }).then((user) => {
          if (user.Notifications) {
            currentNotifications = `${user.Notifications},${request}`;
          } else {
            currentNotifications = `${request}`;
          }
          console.log('current notifications: ', currentNotifications);
        })
          .then(() => {
            User.update({ Notifications: currentNotifications }, { where: { Name: host } })
              .then((affectedRows) => {
                console.log('user notifications: ', affectedRows);
                res.status(201).send('Request successfully made');
              });
          })
          .catch((err) => {
            console.log('error in making request:', err);
            res.status(500).send('error in making request');
          });
      });
  }
});

app.get('/notifications', (req, res) => {
  if (!req.user) {
    res.status(401).send('login first');
  } else {
    User.findOne({ where: { Name: req.user.dataValues.Name } }).then((user) => {
      if (!user.Notifications) {
        res.status(200).send('no notifications!');
      } else {
        const notifications = user.Notifications.split(',');
        console.log(notifications);
        res.status(200).send(notifications);
      }
    });
  }
});

app.post('/approve', (req, res) => {
  let currentContributors;
  Event.findOne({ where: { Name: req.body.eventName } }).then((event) => {
    if (event.Contributor_List) {
      currentContributors = `${event.Contributor_List} ${req.body.approvedUser}`;
    } else {
      currentContributors = req.body.approvedUser;
    }
  })
    .then(() => {
      const eventPair = `${req.body.eventName}:${req.body.approvedUser}`;
      let notifications;
      User.findOne({ where: { Name: req.user.dataValues.Name } }).then((user) => {
        notifications = user.Notifications.replace(eventPair, '');
      }).then(() => {
        User.update({ Notifications: notifications }, { where: { Name: req.user.dataValues.Name } });
      });
    })
    .then(() => {
      Event.update({ Contributor_List: currentContributors }, { where: { Name: req.body.eventName } }).then((affectedRows) => {
        console.log('contributor list updated: ', affectedRows);
        res.status(201).send('request approved');
      });
    })
    .catch((err) => {
      res.status(500).send('error approving requesT:', err);
    });
});

const port = process.env.PORT;

const server = app.listen(port, () => {
  console.log(`app listening on port ${port}`);
});

// Set up socket
const io = socket(server);

io.on('connection', (currentSocket) => {
  console.log('made currentSocket connection', currentSocket.id);
  currentSocket.on('open', (data) => {
    Message.findAll({ where: { Event: data.event } }).then((messages) => {
      messages.forEach((message) => {
        const messageToSend = {
          handle: message.Handle,
          message: message.Message,
          event: message.Event,
        };
        currentSocket.emit('chat', messageToSend);
      });
    });
  });

  currentSocket.on('chat', (data) => {
    Message.create({ Handle: data.handle, Message: data.message, Event: data.event })
      .then(() => {
        io.sockets.emit('chat', data);
      }).catch((err) => {
        console.log(err);
      });
  });
  currentSocket.on('typing', (data) => {
    currentSocket.broadcast.emit('typing', data);
  });
});

// TEST SERVER
// app.listen(80, 'localhost', function() {
//   console.log('successfully hosting on 3001');
// })

module.exports.server = server;
