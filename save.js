/**
 * Logs in to stream.jw.org and saves page to a file.
 * Requires username, password and output file as arguments.
 *
 * Usage: phantomjs login.js username password output
 */

var webpage = require('webpage');
var fs = require('fs');
var system = require('system');
var args = system.args;

if (args.length < 4) {
    console.warn('Usage: phantomjs save.js username password output');
    phantom.exit(1);
}

var username = args[1];
var password = args[2];
var output   = args[3];

start();

// -----

function start() {
    var url = 'https://stream.jw.org';
    var page = webpage.create();
    page.open(url, function(status) {
        if (status === 'success') {
            console.log('Login page ' + url + ' opened');
            setTimeout(function() {
                enterUsername(page);
            }, 3000);
        }
    });
}

function enterUsername(page) {
    console.log('Entering username...');

    // inject username to login form
    // when focus is moved away from username,
    // redirect should happen to another login page where password can be given
    page.evaluate(function(username) {
        var elem = angular.element(document.getElementById('username'));
        elem.val(username);
        elem.triggerHandler('change').triggerHandler('blur');
    }, username);

    // wait 5 sec while we are being redirected to new login page
    setTimeout(function() {
        //page.render('login.png');
        enterPassword(page);
    }, 10000);
}

function enterPassword(page) {
    console.log('Entering password and logging in...');
    // inject password to login form and submit it
    page.evaluate(function(password) {
        document.getElementById('passwordInput').value = password;
        document.getElementById('submitButton').click();
    }, password);

    // wait 10 sec for loading jw stream page
    setTimeout(function() {
        validateLogin(page);
    }, 15000);
}

// Checks if we are logged in by searching word 'Logout' from page
function validateLogin(page) {
    var re = /Logout/;
    if (page.content.match(re)) {
        save(page);
    }
    else {
        console.warn('Login failed.');
        phantom.exit(1);
    }
}

function save(page) {
    //page.render('page.png');
    fs.write(output, page.content, 'w');
    console.log('Page saved as ' + output);
    phantom.exit(0);
}
