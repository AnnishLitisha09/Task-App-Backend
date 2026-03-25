function calculateEndWorkingDateTime(startDate, startTime, durationHours) {
    if (!startDate || !startTime || !durationHours) return null;
    
    let [h, m, s] = startTime.split(':').map(Number);
    let current = new Date(startDate);
    current.setHours(h, m, s || 0);

    const workStartMinutes = 8 * 60 + 45; // 08:45
    const workEndMinutes = 16 * 60 + 30;  // 16:30

    let remainingMinutes = parseFloat(durationHours) * 60;

    // 1. Initial Adjustment: If start time is before working hours, move to start of work
    let currentTotalMinutes = current.getHours() * 60 + current.getMinutes();
    if (currentTotalMinutes < workStartMinutes) {
        current.setHours(8, 45, 0);
        currentTotalMinutes = workStartMinutes;
    } else if (currentTotalMinutes >= workEndMinutes) {
        // Move to next day
        current.setDate(current.getDate() + 1);
        current.setHours(8, 45, 0);
        currentTotalMinutes = workStartMinutes;
    }

    // 2. Walk forward
    while (remainingMinutes > 0) {
        // Skip Sundays
        if (current.getDay() === 0) {
            current.setDate(current.getDate() + 1);
            current.setHours(8, 45, 0);
            currentTotalMinutes = workStartMinutes;
            continue;
        }

        let minutesAvailableToday = workEndMinutes - currentTotalMinutes;
        
        if (remainingMinutes <= minutesAvailableToday) {
            // Fits in today
            current.setMinutes(current.getMinutes() + remainingMinutes);
            remainingMinutes = 0;
        } else {
            // Use up today and move to next day
            remainingMinutes -= minutesAvailableToday;
            current.setDate(current.getDate() + 1);
            current.setHours(8, 45, 0);
            currentTotalMinutes = workStartMinutes;
        }
    }

    const end_date = current.toISOString().split('T')[0];
    const end_time = current.toTimeString().split(' ')[0];
    
    return { end_date, end_time };
}

function test() {
    const scenarios = [
        { name: 'Simple 2h inner', date: '2026-03-31', time: '10:00:00', duration: 2, expected_date: '2026-03-31', expected_time: '12:00:00' },
        { name: 'Late start carry over', date: '2026-03-31', time: '16:00:00', duration: 1, expected_date: '2026-04-01', expected_time: '09:15:00' },
        { name: 'Weekend carry over (Sat to Mon)', date: '2026-03-28', time: '15:00:00', duration: 3, expected_date: '2026-03-30', expected_time: '10:15:00' },
        { name: 'Sunday start', date: '2026-03-29', time: '10:00:00', duration: 1, expected_date: '2026-03-30', expected_time: '09:45:00' }
    ];

    scenarios.forEach(s => {
        const res = calculateEndWorkingDateTime(s.date, s.time, s.duration);
        console.log(`${s.name}: Expected (${s.expected_date} ${s.expected_time}) -> Got (${res.end_date} ${res.end_time})`);
    });
}

test();
