const Ably = require("ably");
const dotenv = require('dotenv')
var path = require('path');

dotenv.config();

const ApiKey = process.env.API_KEY; /* Add your API key here */

/* Instance the Ably REST server library */
var rest = new Ably.Rest({ key: ApiKey });

/* Start the Express.js web server */
const express = require('express'),
      app = express(),
      cookieParser = require('cookie-parser');

app.use(cookieParser());

/* Server static content from the root path to keep things simple */
app.use(express.static(path.join(__dirname, 'docs/hello-world')));

/* Issue token requests to clients sending a request
   to the /auth endpoint */
app.get('/auth', function (req, res) {
  var tokenParams;
  /* Check if the user is logged in */
  if (req.cookies.username) {
    /* Issue a token with pub & sub permissions for all channels +
       configure the token with an indentity */
    tokenParams = {
      'capability': { '*': ['publish', 'subscribe', 'presence', 'history'] },
      'clientId': req.cookies.username
    };
  } else {
    /* Issue a token request with subscribe privileges restricted to one channel
       and configure the token without an identity (anonymous) */
    tokenParams = {
      'capability': { '*': ['publish', 'subscribe', 'presence', 'history'] },
      'clientId': '*'
    };
  }

  console.log("Sending signed token request:", JSON.stringify(tokenParams));
  rest.auth.createTokenRequest(tokenParams, function(err, tokenRequest) {
    if (err) {
      res.status(500).send('Error requesting token: ' + JSON.stringify(err));
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify(tokenRequest));
    }
  });
});

/* Set a cookie when the user logs in */
app.get('/login', function (req, res) {
  /* Login the user without credentials.
     This is an over simplified authentication system
     to keep this tutorial simple */
  if (req.query['username']) {
    res.cookie('username', req.query['username']);
    res.redirect('/');
  } else {
    res.status(500).send('Username is required to login');
  }
});

/* Clear the cookie when the user logs outs */
app.get('/logout', function (req, res) {
  res.clearCookie('username');
  res.redirect('/');
});

app.listen(process.env.PORT || 3000, function () {
  console.log('Web server listening on port 3000');
});