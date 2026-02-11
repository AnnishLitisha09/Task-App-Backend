const { Venue } = require('./models');

async function debugVenues() {
    try {
        const venues = await Venue.findAll();
        console.log("Total Venues:", venues.length);
        if (venues.length === 0) console.log("No venues found!");
        venues.forEach(v => {
            console.log(`Venue ID: ${v.venue_id}, Name: ${v.name}`);
        });
    } catch (error) {
        console.error("Error:", error);
    }
}

debugVenues();
