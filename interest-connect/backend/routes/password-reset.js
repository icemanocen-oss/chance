const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');

// ========================================
// 1. ЗАПРОС НА ВОССТАНОВЛЕНИЕ ПАРОЛЯ
// ========================================
// @route   POST /api/password/forgot
// @desc    Send password reset email
// @access  Public
router.post('/forgot', [
  body('email').isEmail().withMessage('Valid email is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email } = req.body;

    // Найти пользователя
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      // Не раскрываем информацию о существовании email
      return res.status(200).json({ 
        message: 'Если email существует в системе, на него отправлена ссылка для сброса пароля' 
      });
    }

    // Генерируем токен
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    // Хешируем токен перед сохранением в БД
    const resetTokenHash = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    // Сохраняем хешированный токен (expires через 1 час)
    user.resetPasswordToken = resetTokenHash;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 час
    await user.save();

    // В продакшене здесь нужно отправить email
    // Для разработки просто возвращаем токен
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password.html?token=${resetToken}`;

    // TODO: Отправить email через nodemailer
    console.log('Reset URL:', resetUrl);
    console.log('Reset Token:', resetToken);

    res.status(200).json({ 
      message: 'Если email существует в системе, на него отправлена ссылка для сброса пароля',
      // ТОЛЬКО ДЛЯ РАЗРАБОТКИ - удалить в продакшене!
      resetUrl: resetUrl,
      token: resetToken
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ========================================
// 2. ПРОВЕРКА ВАЛИДНОСТИ ТОКЕНА
// ========================================
// @route   GET /api/password/verify/:token
// @desc    Verify reset token
// @access  Public
router.get('/verify/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    // Хешируем токен для поиска в БД
    const resetTokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Проверяем токен и срок действия
    const user = await User.findOne({
      resetPasswordToken: resetTokenHash,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ 
        error: 'Неверный или истекший токен' 
      });
    }

    res.status(200).json({ 
      message: 'Токен действителен',
      email: user.email 
    });

  } catch (error) {
    console.error('Verify token error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ========================================
// 3. СБРОС ПАРОЛЯ
// ========================================
// @route   POST /api/password/reset
// @desc    Reset password with token
// @access  Public
router.post('/reset', [
  body('token').notEmpty().withMessage('Token is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { token, newPassword } = req.body;

    // Хешируем токен
    const resetTokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Находим пользователя
    const user = await User.findOne({
      resetPasswordToken: resetTokenHash,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ 
        error: 'Неверный или истекший токен' 
      });
    }

    // Хешируем новый пароль
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Обновляем пароль и удаляем токен
    user.password = hashedPassword;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    res.status(200).json({ 
      message: 'Пароль успешно изменён. Теперь можете войти с новым паролем.' 
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;