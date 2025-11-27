require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch(err => {
    console.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
  });

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/events', require('./routes/events'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/password', require('./routes/password-reset'));

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to InterestConnect API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth (register, login)',
      users: '/api/users (profile, search, matches)',
      groups: '/api/groups (create, join, search)',
      events: '/api/events (create, join, browse)',
      messages: '/api/messages (chat)'
    }
  });
});

// Socket.IO for real-time chat
const Message = require('./models/Message'); // Убедись, что есть модель Message
const activeUsers = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  console.log(`✅ User connected: ${socket.userId}`);
  activeUsers.set(socket.userId, socket.id);
  io.emit('user_online', { userId: socket.userId });
  socket.join(socket.userId);

  socket.on('send_message', async (data) => {
    try {
      const { receiverId, groupId, content } = data;
      const message = new Message({
        sender: socket.userId,
        receiver: receiverId || null,
        group: groupId || null,
        content,
        messageType: 'text'
      });
      await message.save();

      const populatedMessage = await Message.findById(message._id)
        .populate('sender', 'name profilePicture')
        .populate('receiver', 'name profilePicture');

      if (receiverId) {
        io.to(receiverId).emit('new_message', populatedMessage);
        socket.emit('message_sent', populatedMessage);
      }

      if (groupId) {
        io.to(`group_${groupId}`).emit('new_message', populatedMessage);
      }
    } catch (error) {
      console.error('Send message error:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  socket.on('join_group', (groupId) => {
    socket.join(`group_${groupId}`);
    console.log(`User ${socket.userId} joined group ${groupId}`);
  });

  socket.on('leave_group', (groupId) => {
    socket.leave(`group_${groupId}`);
    console.log(`User ${socket.userId} left group ${groupId}`);
  });

  socket.on('typing', (data) => {
    const { receiverId, isTyping } = data;
    if (receiverId) {
      io.to(receiverId).emit('user_typing', { userId: socket.userId, isTyping });
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ User disconnected: ${socket.userId}`);
    activeUsers.delete(socket.userId);
    io.emit('user_offline', { userId: socket.userId });
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}`);
  console.log(`💬 Socket.IO: Ready for real-time connections`);
});

module.exports = { app, io };
