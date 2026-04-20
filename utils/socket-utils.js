let io;
const userSockets = new Map();

module.exports = {
  init: (server) => {
    const socketIo = require('socket.io');
    io = socketIo(server, {
      cors: { origin: "*" }
    });

    io.on('connection', (socket) => {
      console.log('New client connected:', socket.id);

      socket.on('join', (userId) => {
        if (userId) {
          userSockets.set(userId.toString(), socket.id);
          console.log(`User ${userId} joined their notification channel.`);
        }
      });

      socket.on('disconnect', () => {
        for (let [userId, socketId] of userSockets.entries()) {
          if (socketId === socket.id) {
            userSockets.delete(userId);
            break;
          }
        }
        console.log('Client disconnected:', socket.id);
      });
    });

    return io;
  },
  getIO: () => {
    if (!io) {
      // Return a mock if not initialized yet to prevent crashes
      return { emit: () => {} };
    }
    return io;
  },
  sendToUser: (userId, event, data) => {
    if (!io) return;
    const socketId = userSockets.get(userId.toString());
    if (socketId) {
      io.to(socketId).emit(event, data);
      return true;
    }
    return false;
  }
};
