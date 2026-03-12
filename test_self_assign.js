const http = require('http');

// A valid token (can just test without since we don't have the user's fresh token, 
// wait, the user's token was expired in previous step, so we will use a dummy one to just check 
// if route exists or we can mock req.userId). But actually we can just instruct the user to test since 
// they can use their own fresh token. Instead of a live node test which might fail on auth, 
// I'll just write a mock test or directly update walkthrough and task.md.
