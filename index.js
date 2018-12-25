#!/usr/bin/env node

/**
 * Downloads videos from JW Stream.
 * Skips already downloaded video files.
 */

var htmlparser   = require('htmlparser2');
var fs           = require('fs');
var path         = require('path');
const phantom    = require('phantom');
var program      = require('commander');
var co           = require('co');
var prompt       = require('co-prompt');
var chalk        = require('chalk');
var request      = require('request');
var lineLog      = require('single-line-log').stdout;
var progress     = require('request-progress');

// default video name filter
var nameFilter = '';

program
    .option('-u, --username <username>', 'The user to authenticate as')
    .option('-p, --password <password>', 'The user\'s password')
    .option('-d, --dir <dir>', 'Working directory')
    .option('-f, --filter <regexp>', 'Video name filter')
    .option('-j, --json', 'Prints program data in JSON, no downloading')
    .version('1.5.0')
    .parse(process.argv);

co(function *() {
    // if not provided as arguments, prompt credentials
    var username = program.username || (yield prompt('Username: '));
    var password = program.password || (yield prompt.password('Password: '));
    workDir = program.dir || '.';
    nameFilter = program.filter || nameFilter;
    run(username, password, workDir, program.json);
});

// -----

async function run(username, password, dir, jsonMode) {
    const result = await startPhantom(username, password);
    const content = result.content;
    if (content !== null) {
        var videos = parse(content);
        if (jsonMode) {
            const data = {
                videos: videos,
                session: result.sessionId,
            };
            console.log(JSON.stringify(data, null, 2));
        }
        else {
            download(videos, dir);
        }
    }
    else {
        console.warn(chalk.red('Reading JW Stream failed.'));
        process.exit(1);
    }
}

function parse(html) {
    var videos = [];
    var video = null;
    var path = [];
    var url = null;
    var parser = new htmlparser.Parser({
        onopentag: function(tagName, attrs) {
            path.push({
                tagName: tagName,
                attrs: attrs
            });

            if (tagName === 'article') {
                // every video belongs to article tag
                if (video !== null) {
                    videos.push(video);
                }
                video = { media: {} };
            }
            else if (tagName === 'a' && video !== null) {
                url = attrs['href'];
            }
        },
        ontext: function(text) {
            var l = path.length;
            if (video !== null) {
                // language
                if (l > 4 &&
                    path[l-3]['tagName'] === 'header' &&
                    path[l-2]['tagName'] === 'span' &&
                    path[l-1]['tagName'] === 'span' && path[l-1]['attrs']['data-stringcode']) {
                    video.language = text;
                }

                // url
                if (url) {
                    video.media[text] = url;
                    url = null;
                }

                // program
                if (l > 3 &&
                    path[l-2]['tagName'] === 'header' &&
                    path[l-1]['tagName'] === 'h1') {
                    // clean text
                    text = text.replace(/\\n/g, '');
                    video.program = text.trim();
                }
            }
        },
        onclosetag: function(tagName) {
            path.pop();
        }
    }, { decodeEntities: true });

    parser.write(html);
    parser.end();

    //console.log("Videos: " + JSON.stringify(videos, undefined, 4));
    return videos;
}

function download(videos, dir) {
    var regex = new RegExp(nameFilter, 'i');
    if (nameFilter) {
        console.log(chalk.cyan('Filter: ' + nameFilter));
    }
    for (var i = 0; i < videos.length; i++) {
        var video = videos[i];
        var url = video.media['720p'];
        if (!video.program.match(regex)) {
            console.log(chalk.gray('Ignoring ' + video.program));
            continue;
        }
        var target = path.join(dir, video.program + '.mp4');
        if (fs.existsSync(target)) {
            console.log(chalk.yellow(target + ' already exists, skipping'));
            continue;
        }
        console.log('Downloading ' + chalk.green(target) + ' (' + url + ')');
        progress(request(url), {
        })
        .on('progress', function(state) {
            if (state.time.remaining) {
                var hours = Math.floor(state.time.remaining / 3600);
                var mins = Math.floor(state.time.remaining % 3600 / 60);
                var secs = Math.floor(state.time.remaining % 60);
                var remaining = '';
                if (hours) {
                    remaining += hours + ':';
                }
                if (mins < 10) remaining += '0';
                remaining += mins + ':';

                if (secs < 10) remaining += '0';
                remaining += secs;

                lineLog(chalk.yellow('' + Math.round(state.percent * 100) + '% ') + remaining + ' remaining');
            }
        })
        .on('error', function(err) {
            console.err(err);
        })
        .on('end', function() {
            console.log("\n");
        })
        .pipe(fs.createWriteStream(target));
    }
}

// wait helper function
function wait(timeout) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, timeout);
    });
}

// Phantom section

async function startPhantom(username, password) {
    var url = 'https://stream.jw.org';
    const instance = await phantom.create();
    phantom.cookiesEnabled = true;
    const page = await instance.createPage();

    await page.open(url);

    await wait(3000);
    const content = await enterUsername(page, username, password);
    const cookies = await page.property('cookies');
    var sessionId = null;
    for (var i in cookies) {
        if (cookies[i].name === 'sessionstream') {
            sessionId = cookies[i].value;
        }
    }

    await instance.exit();
    return {
        content,
        sessionId,
    };
}

async function enterUsername(page, username, password) {
    // inject username to login form
    // redirect should happen to another login page where password can be given
    await page.evaluate(function(username) {
        var elem = angular.element(document.getElementById('username'));
        elem.val(username);
        elem.triggerHandler('change').triggerHandler('blur');

        // send click event to submit button
        var btn = angular.element(document.getElementById('button'));
        btn.triggerHandler('click');
    }, username);

    // wait 5 sec while we are being redirected to new login page
    await wait(5000);
    return await enterPassword(page, password);
}

async function enterPassword(page, password) {
    // inject password to login form and submit it
    await page.evaluate(function(password) {
        document.getElementById('passwordInput').value = password;
        document.getElementById('submitButton').click();
    }, password);

    // wait 15 sec for loading jw stream page
    await wait(15000);

    return await validateLogin(page);
}

// Checks if we are logged in by searching word 'Logout' from page
async function validateLogin(page) {
    var re = /Logout/;
    const content = await page.property('content');
    if (content.match(re)) {
        return content;
    }
    else {
        return null;
    }
}
