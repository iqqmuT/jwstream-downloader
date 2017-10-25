#!/usr/bin/env node

/**
 * Downloads videos from JW Stream.
 * Skips already downloaded video files.
 */

var htmlparser   = require('htmlparser2');
var fs           = require('fs');
var path         = require('path');
var childProcess = require('child_process');
var phantomjs    = require('phantomjs-prebuilt');
var curl         = require('node-curl-download');
var program      = require('commander');
var co           = require('co');
var prompt       = require('co-prompt');
var chalk        = require('chalk');

var htmlFile = 'page.html';

// default video name filter
var nameFilter = '';

program
    .arguments('<dir>')
    .option('-u, --username <username>', 'The user to authenticate as')
    .option('-p, --password <password>', 'The user\'s password')
    .option('-f, --filter <regexp>', 'Video name filter')
    .action(function(dir) {
        co(function *() {
            // if not provided as arguments, prompt credentials
            var username = program.username || (yield prompt('Username: '));
            var password = program.password || (yield prompt.password('Password: '));
            nameFilter = program.filter || nameFilter;
            run(username, password, dir);
        });
    })
    .parse(process.argv);

// -----

function run(username, password, dir) {
    var childArgs = [
        path.join(__dirname, 'save.js'),
        username,
        password,
        'page.html'
    ];

    // run phantomjs first to save html page
    childProcess.execFile(phantomjs.path, childArgs, function(err, stdout, stderr) {
        console.log(chalk.blue(stdout));
        if (stderr) {
            console.warn(chalk.red(stderr));
        }

        if (!err) {
            var videos = parse();
            download(videos, dir);
        }
        else {
            console.warn(chalk.red('Reading JW Stream failed.'));
            process.exit(1);
        }
    });
}

function parse() {
    var videos = [];
    var video = null;
    var parser = new htmlparser.Parser({
        onopentag: function(tagName, attrs) {
            if (tagName === 'article') {
                // every video belongs to article tag
                if (video !== null) {
                    videos.push(video);
                }
                video = {};
            }
            else if (tagName === 'h1' && video !== null && video.name === undefined) {
                video.name = attrs['alt'];
            }
            else if (tagName === 'a' && video !== null && video.url === undefined) {
                video.url = attrs['href'];
            }
        },
    }, { decodeEntities: true });

    var html = fs.readFileSync(htmlFile);
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
        if (!video.name.match(regex)) {
            console.log(chalk.gray('Ignoring ' + video.name));
            continue;
        }
        var target = path.join(dir, video.name + '.mp4');
        if (fs.existsSync(target)) {
            console.log(chalk.yellow(target + ' already exists, skipping'));
            continue;
        }
        var dl = new curl.Download(video.url, target);
        console.log('Downloading ' + chalk.green(target) + ' (' + video.url + ')');
        dl.start();
    }
}
