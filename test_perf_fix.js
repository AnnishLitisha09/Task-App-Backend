const { getWorkingMinutes } = require('./jobs/task-escalation');

// Test 1: Simple range within working hours
const start1 = new Date('2026-03-13T09:00:00'); // 9:00 AM
const end1 = new Date('2026-03-13T10:00:00');   // 10:00 AM
console.log('Test 1 (1 hour):', getWorkingMinutes(start1, end1), 'expected 60');

// Test 2: Overnight
const start2 = new Date('2026-03-12T15:00:00'); // 3:00 PM Thursday
const end2 = new Date('2026-03-13T09:00:00');   // 9:00 AM Friday
// Thursday: 3:00 PM to 4:00 PM (60 mins)
// Friday: 8:45 AM to 9:00 AM (15 mins)
console.log('Test 2 (Overnight):', getWorkingMinutes(start2, end2), 'expected 75');

// Test 3: Sunday crossing
const start3 = new Date('2026-03-14T15:00:00'); // 3:00 PM Saturday
const end3 = new Date('2026-03-16T10:00:00');   // 10:00 AM Monday
// Saturday: 3:00 PM to 4:00 PM (60 mins)
// Sunday: 0 mins
// Monday: 8:45 AM to 10:00 AM (75 mins)
console.log('Test 3 (Weekends):', getWorkingMinutes(start3, end3), 'expected 135');

// Test 4: Long range performance (1 year)
const start4 = new Date('2025-01-01T08:00:00');
const end4 = new Date('2026-01-01T08:00:00');
console.time('Time: 1 Year Range');
const mins = getWorkingMinutes(start4, end4);
console.timeEnd('Time: 1 Year Range');
console.log('Test 4 (1 year mins):', mins);
