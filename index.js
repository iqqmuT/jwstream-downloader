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
var program      = require('commander');
var co           = require('co');
var prompt       = require('co-prompt');
var chalk        = require('chalk');
var request      = require('request');
var lineLog      = require('single-line-log').stdout;
var progress     = require('request-progress');

var htmlFile = 'page.html';

// default video name filter
var nameFilter = '';

program
    .option('-u, --username <username>', 'The user to authenticate as')
    .option('-p, --password <password>', 'The user\'s password')
    .option('-d, --dir <dir>', 'Working directory')
    .option('-f, --filter <regexp>', 'Video name filter')
    .option('-j, --json', 'Prints program data in JSON, no downloading')
    .version('1.3.0')
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

function run(username, password, dir, jsonMode) {
    var childArgs = [
        path.join(__dirname, 'save.js'),
        username,
        password,
        'page.html'
    ];

    // run phantomjs first to save html page
    childProcess.execFile(phantomjs.path, childArgs, function(err, stdout, stderr) {
        //console.log(chalk.blue(stdout));
        if (stderr) {
            console.warn(chalk.red(stderr));
        }

        if (!err) {
            var videos = parse();
            if (jsonMode) {
                console.log(JSON.stringify(videos, null, 2));
            }
            else {
                download(videos, dir);
            }
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
