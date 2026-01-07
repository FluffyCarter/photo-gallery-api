const multer = require('multer');

const errorHandler = (err, req, res, next) => {
    console.error('❌ Ошибка в обработчике:', err.stack);
    
    // Ошибки multer
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'Размер файла слишком большой. Максимальный размер 10MB'
            });
        }
        return res.status(400).json({
            success: false,
            message: err.message
        });
    }
    
    // Другие ошибки
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Внутренняя ошибка сервера',
        error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
};

module.exports = errorHandler;