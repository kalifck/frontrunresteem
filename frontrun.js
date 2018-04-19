var FULL_CURATION_TIME = 30 * 60 * 1000;
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

                        var pre_30_min_pct = Math.min(new Date() - new Date(result.created + 'Z'), FULL_CURATION_TIME) / FULL_CURATION_TIME;
                        post.curation_reward = (Math.sqrt((post.payout + 1) * 0.25) - Math.sqrt(post.payout * 0.25)) * Math.sqrt((post.payout + 1 + post.vote_value) * 0.25) * pre_30_min_pct;

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


function scurate(posts) {

    for (var i = 0; i < posts.length; i++) {
        authors.push(posts[i].author);
        permlinks.push(posts[i].permlink);
    }
    checkpost();
}



//Fetching reblogged posts for comparison with recent frontrun posts
function checkpost() {
    
    steem.api.getAccountHistory(username, -1, 1000, function (err, result) {

        result.forEach(trans => {
            var op = trans[1].op;

            //Check for reblogged posts with available frontrun posts
            if (op[0] == 'custom_json' && op[1].id == 'follow') {
                var json = JSON.parse(op[1].json);
                var { author, permlink } = json[1];
                rpermlink.push(permlink);
            }
            //Calculate the num for post tally
            if (op[0] == 'comment' && op[1].permlink) {
                var arrperm = op[1].permlink;
                tallyperm.push(arrperm);
            }
        });

        const x = tallyperm.filter(item => item.match(/^curation-\d+$/))
        

        var num_loaded = Math.max.apply(null, (x.map(function (item) { return item.replace(/curation-/g, '') })
        ));

        //Reversing the whole array to get the latest reblogged post
        rpermlink = rpermlink.reverse();
        if (rpermlink.length > 3) { rpermlink.length = 5;}

        //Using cli-table to print data
        var Table = require('cli-table2');
        var table = new Table({
            head: ["index", "author", "permlinks","reblogged","tallypost"],
            wordWrap: true
        });

        for (var i = 0; i < 5; i++) {
            table.push([i + 1, authors[i], permlinks[i], rpermlink[i], num_loaded]);
        }

        console.log(table.toString());

        //Comparing the reblogged author,permlinks to the author,permlinks provided by steembottracker
        rpermlink.forEach(r => {
            var check = permlinks.includes(r);

            //If there is difference in authors, new posts to resteemed
            if (check == false) {
                console.log("there's new frontrun post!");

                num_loaded++;

                newpost1 = newpost1.replace(/{num}/g, num_loaded);
                var newpost = JSON.parse(newpost1);
                createPost(newpost);
               

            } else {
                console.log("no new frontrun posts!");
            }

        });


        /*steem.api.getActiveVotes(authors[0], permlinks[0], function (err, result) {
            result.forEach(function (data) {
                //console.log(data.voter, upvoterbots[0]);
                if (data.voter == upvoterbots[0]) {
                    console.log("Voted by bots! No need to upvote.")
                } else {
                    console.log("proceed upvote!")
                }
            });*/
    });
}

function createPost(newpost) {
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
            console.log(err, result);
            if (result) {
                console.log(result.name);
                resteem();
            } if (err) {
                try { throw err }
                catch (err) {
                    console.log(err.name);
                    console.log('===========================create post failed')
                    setTimeout(frontRun, 5 * 60 * 1000);
                }
            }
        });
}

//Choosing the top 2 post in terms of curation rewards
function resteem(j) {

    for (j = 0; j < 2; j++) {
        const json = JSON.stringify(['reblog', {
            account: username,
            author: authors[j],
            permlink: permlinks[j]
        }]);


        steem.broadcast.customJson(privPostingWif, [], [username], 'follow', json, function (err, result) {
            if (result) {
                console.log('successfully resteemed');
            } if (err) {
                console.log(err.message);
                console.log('===================Resteemed failed')
                j++;
                resteem(j);
            }
        });
    }

}