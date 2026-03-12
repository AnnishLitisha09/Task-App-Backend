const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3002,
  path: '/api/tasks/284/exhaustive',
  method: 'GET',
  headers: {
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjo0MCwicm9sZSI6ImZhY3VsdHkiLCJpYXQiOjE3NzMxNTg3MDAsImV4cCI6MTc3MzI0NTEwMH0.-1LN7NBy7Nh7hkMoRDCsapqO-V8ifZ5KgfGZ7sH1cPw'
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('--- ASSIGNMENT STATS ---');
      console.log(JSON.stringify(json.assignment_stats, null, 2));
    } catch(e) {
      console.log('Error parsing JSON:', data);
    }
  });
});

req.on('error', (error) => {
  console.error(error);
});

req.end();
