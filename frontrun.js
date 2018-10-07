var FULL_CURATION_TIME = 15 * 60 * 1000; // new curation Time of 15 min after HF20 in Steemit 25.09.2018
var api_url = 'https://steembottracker.net';
const fs = require('fs');
const axios = require('axios');
const steem = require('steem');

var newpost1 = fs.readFileSync('newpost.json', 'utf-8');
const content = fs.readFileSync('content.txt', 'utf-8');
var config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
var authors = [];
var permlinks = [];
const username = config.account;
const privPostingWif = config.privPostingWif;
var posts;
var rpermlink = [];
var tallyperm = [];

// Connect to the specified RPC node
var rpc_node = config.rpc_nodes ? config.rpc_nodes[1] : (config.rpc_node ? config.rpc_node : 'https://api.steemit.com');
steem.api.setOptions({ transport: 'http', uri: rpc_node, url: rpc_node });
console.log("Connected to: " + rpc_node);

frontRun();

function frontRun() {
    axios
        .get(api_url + '/posts')
        .then(data => {
            posts = data.data;

            var num_loaded = 0;
            posts.forEach(function (post) {
                var permLink = post.permlink;
                var author = post.author;


                steem.api.getContent(author, permLink, function (err, result) {
                    if (!err && result && result.id > 0) {
                        post.created = new Date(result.created + 'Z');
                        post.payout = parseFloat(result.pending_payout_value);
                        post.title = result.title;
                        post.author = result.author;
                        post.permlink = result.permlink;
                        // changed to pre_15_min_pct and curation reward calculation to 30%, again because of the HF20 
                        var pre_15_min_pct = Math.min(new Date() - new Date(result.created + 'Z'), FULL_CURATION_TIME) / FULL_CURATION_TIME;
                        post.curation_reward = (Math.sqrt((post.payout + 1) * 0.3) - Math.sqrt(post.payout * 0.3)) * Math.sqrt((post.payout + 1 + post.vote_value) * 0.25) * pre_15_min_pct;

                    }

                    num_loaded++;

                    if (num_loaded >= posts.length) {
                        posts.sort(function (a, b) { return parseFloat(b.curation_reward) - parseFloat(a.curation_reward) });
                        scurate(posts);
                    }
                })
            })
        });
}


//Pushing array to permlinks and authors
function scurate(posts) {

    for (var i = 0; i < posts.length; i++) {
        authors.push(posts[i].author);
        permlinks.push(posts[i].permlink);
    }
    queryRPost();
}
        

//Comparing the reblogged author,permlinks to the author,permlinks provided by steembottracker
//Fetching already reblogged posts
function queryRPost() {

    steem.api.getAccountHistory(username, -1, 1000, function (err, result) {

        result.forEach(trans => {
            var op = trans[1].op;

            //Only care about operation named customjson and follow id
            if (op[0] == 'custom_json' && op[1].id == 'follow') {
                var json = JSON.parse(op[1].json);
                var { author, permlink } = json[1];
                rpermlink.push(permlink);
            }

            if (op[0] == 'comment' && op[1].permlink) {
                var nperm = op[1].permlink;
                tallyperm.push(nperm);
            }
        });

        const x = tallyperm.filter(item => item.match(/^curation-\d+$/))

        num_loaded = Math.max.apply(null, (x.map(function (item) { return item.replace(/curation-/g, '') })
        ));

        //Reversing the whole array to get the latest reblogged post
        rpermlink = rpermlink.reverse();
        rpermlink.length = 2;

        //Using cli-table to print data
        var Table = require('cli-table2');
        var table = new Table({
            head: ["index", "author", "permlinks", "reblogged", "tallypost"],
            wordWrap: true
        });

        for (var i = 0; i < 5; i++) {
            table.push([i + 1, authors[i], permlinks[i], rpermlink[i], num_loaded]);
        }

        console.log(table.toString());
        checkpost();
    })
}


function checkpost() {
    //Comparing the reblogged author,permlinks to the author,permlinks provided by steembottracker
    check = rpermlink.every((link) => permlinks.includes(link))
    console.log('No posts available: ' + check);

    //If there is difference in authors, new data created
    if (check == false) {
        console.log("There's new frontrun post!  ");
        createPost();

    } else if (check == true) {
        console.log("No new frontrun posts!");
        setTimeout(frontRun, 5000);
    }
}

function createPost(newpost) {
    num_loaded++;

    newpost1 = JSON.parse(newpost1.replace(/{num}/g, num_loaded));
    var newpost = newpost1;

    steem.broadcast.comment(
        privPostingWif,  // Steemit.com Walvar -> Permissions -> Show Private Key (for Posting)
        newpost.parent_author,        // empty for new blog post 
        newpost.parent_permlink,      // main tag for new blog post
        username,               // same user the private_posting_key is for
        newpost.permlink,             // a slug (lowercase 'a'-'z', '0'-'9', and '-', min 1 character, max 255                                          characters)
        newpost.title,                // human-readable title
        content,                 // body of the post or comment
        newpost.json_metadata,         // arbitrary metadata
        function (err, result) {
            if (result) {
                resteem();
            } if (err) {
                try { throw err }
                catch (err) {
                    console.log(err.message);
                    console.log('===========================create post failed')
                    setTimeout(frontRun, 5 * 60 * 1000);
                }
            }
        });
}

//Choosing the top 2 post in terms of curation rewards
function resteem(j) {
    var sucess = 0;
    for (j = 0; j < 2; j++) {
        const json = JSON.stringify(['reblog', {
            account: username,
            author: authors[j],
            permlink: permlinks[j]
        }]);

        steem.broadcast.customJson(privPostingWif, [], [username], 'follow', json, function (err, result) {
            if (result) {
                sucess++;
                console.log('========================================');
                console.log('       Successfully resteemed');
                console.log('========================================')
            } else if (err) {
                console.log('=================================================');
                console.log(err.message);
                console.log('=================================================');
                if (sucess < 2) {
                    for (j += 1; j < permlinks.length; j++) {
                        resteem(j);
                    }
                }
            }
            console.log(json);
        });
    }
}

function sleep(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    })
}
