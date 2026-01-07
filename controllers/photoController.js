const db = require('../config/database');

class PhotoController {
    // Загрузка фотографии
    async uploadPhoto(req, res) {
        try {
            // Проверяем, что файл был загружен
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'No file uploaded. Please select an image file.'
                });
            }

            const { originalname, buffer, mimetype, size } = req.file;
            
            // Безопасное получение данных из body
            const description = req.body?.description || null;
            const tags = req.body?.tags ? req.body.tags.split(',').map(t => t.trim()) : null;

            console.log('📤 Получен запрос на загрузку фото');
            console.log('📄 Файл:', originalname);
            console.log('📏 Размер:', size, 'bytes');
            console.log('📝 Описание:', description);
            console.log('🏷️ Теги:', tags);

            // Проверяем размер файла
            const maxFileSize = 10 * 1024 * 1024; // 10MB
            if (size > maxFileSize) {
                return res.status(400).json({
                    success: false,
                    message: `File too large. Maximum size is ${maxFileSize / 1024 / 1024}MB`
                });
            }

            let imageBuffer = buffer;
            let width = null;
            let height = null;

            // Оптимизация изображения с помощью sharp
            try {
                const image = sharp(buffer);
                const metadata = await image.metadata();
                
                width = metadata.width;
                height = metadata.height;

                // Оптимизируем если изображение слишком большое
                if (metadata.width > 2000 || metadata.height > 2000) {
                    imageBuffer = await image
                        .resize(2000, 2000, {
                            fit: 'inside',
                            withoutEnlargement: true
                        })
                        .jpeg({ quality: 85 })
                        .toBuffer();
                    
                    console.log('🔄 Изображение оптимизировано:', {
                        original: size,
                        optimized: imageBuffer.length,
                        reduction: `${((size - imageBuffer.length) / size * 100).toFixed(1)}%`
                    });
                }
            } catch (sharpError) {
                console.warn('⚠️ Ошибка оптимизации изображения:', sharpError.message);
                // Продолжаем с оригинальным буфером
            }

            // Вставляем данные в базу
            const result = await db.query(
                `INSERT INTO photos 
                (filename, image_data, mime_type, file_size, width, height, description, tags) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
                RETURNING id, filename, created_at`,
                [
                    originalname,
                    imageBuffer,
                    mimetype,
                    imageBuffer.length,
                    width,
                    height,
                    description,
                    tags
                ]
            );

            console.log('✅ Фото успешно сохранено в БД, ID:', result.rows[0].id);

            res.status(201).json({
                success: true,
                data: {
                    ...result.rows[0],
                    file_size: imageBuffer.length,
                    width: width,
                    height: height
                },
                message: 'Photo uploaded successfully'
            });

        } catch (error) {
            console.error('❌ Ошибка загрузки фото:', error.message);
            console.error('Stack:', error.stack);
            
            // Определяем тип ошибки
            let statusCode = 500;
            let errorMessage = 'Error uploading photo';
            
            if (error.code === '23505') { // unique violation
                statusCode = 409;
                errorMessage = 'Photo with this filename already exists';
            } else if (error.code === '23502') { // not null violation
                statusCode = 400;
                errorMessage = 'Required field is missing';
            }
            
            res.status(statusCode).json({
                success: false,
                message: errorMessage,
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
    
    // Получение списка фотографий (без самих изображений)
    async getPhotos(req, res) {
        try {
            const { page = 1, limit = 20, tag } = req.query;
            const offset = (page - 1) * limit;
            
            let query = `SELECT id, filename, mime_type, file_size, 
                        width, height, created_at, updated_at, 
                        description, tags 
                        FROM photos`;
            let queryParams = [];
            let whereClause = '';
            
            if (tag && tag.trim() !== '') {
                whereClause = ` WHERE $${queryParams.length + 1} = ANY(tags)`;
                queryParams.push(tag.trim());
            }
            
            query += whereClause + ` ORDER BY created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
            queryParams.push(parseInt(limit), offset);
            
            console.log('📋 Запрос списка фото:', query);
            console.log('📊 Параметры:', queryParams);
            
            const result = await db.query(query, queryParams);
            
            // Получаем общее количество для пагинации
            const countQuery = 'SELECT COUNT(*) FROM photos' + whereClause;
            const countResult = await db.query(countQuery, whereClause ? queryParams.slice(0, -2) : []);
            
            const total = parseInt(countResult.rows[0].count);
            
            console.log('✅ Найдено фото:', total);

            res.json({
                success: true,
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: total,
                    totalPages: Math.ceil(total / limit)
                }
            });
            
        } catch (error) {
            console.error('❌ Ошибка получения списка фото:', error);
            res.status(500).json({
                success: false,
                message: 'Error fetching photos'
            });
        }
    }
    
    // Получение конкретной фотографии (только метаданные)
    async getPhoto(req, res) {
        try {
            const { id } = req.params;
            
            console.log('🔍 Запрос фото ID:', id);
            
            const result = await db.query(
                `SELECT id, filename, mime_type, file_size, 
                width, height, created_at, updated_at, 
                description, tags 
                FROM photos WHERE id = $1`,
                [id]
            );
            
            if (result.rows.length === 0) {
                console.log('⚠️ Фото не найдено, ID:', id);
                return res.status(404).json({
                    success: false,
                    message: 'Photo not found'
                });
            }
            
            console.log('✅ Фото найдено:', result.rows[0].filename);

            res.json({
                success: true,
                data: result.rows[0]
            });
            
        } catch (error) {
            console.error('❌ Ошибка получения фото:', error);
            res.status(500).json({
                success: false,
                message: 'Error fetching photo'
            });
        }
    }
    
    // Получение изображения (бинарные данные)
    async getImage(req, res) {
        try {
            const { id } = req.params;
            
            console.log('🖼️ Запрос изображения ID:', id);
            
            const result = await db.query(
                'SELECT image_data, mime_type FROM photos WHERE id = $1',
                [id]
            );
            
            if (result.rows.length === 0) {
                console.log('⚠️ Изображение не найдено, ID:', id);
                return res.status(404).json({
                    success: false,
                    message: 'Image not found'
                });
            }
            
            const photo = result.rows[0];
            
            console.log('✅ Отправка изображения:', photo.mime_type, 'размер:', photo.image_data.length);

            // Устанавливаем правильные заголовки
            res.set({
                'Content-Type': photo.mime_type,
                'Content-Length': photo.image_data.length,
                'Cache-Control': 'public, max-age=31536000',
                'Content-Disposition': `inline; filename="photo_${id}"`
            });
            
            res.send(photo.image_data);
            
        } catch (error) {
            console.error('❌ Ошибка получения изображения:', error);
            res.status(500).json({
                success: false,
                message: 'Error fetching image'
            });
        }
    }
    
    // Обновление информации о фото
    async updatePhoto(req, res) {
        try {
            const { id } = req.params;
            const { description, tags } = req.body;
            
            console.log('✏️ Обновление фото ID:', id);
            console.log('📝 Новое описание:', description);
            console.log('🏷️ Новые теги:', tags);

            const result = await db.query(
                `UPDATE photos 
                SET description = COALESCE($1, description), 
                    tags = COALESCE($2, tags) 
                WHERE id = $3 
                RETURNING id, filename, description, tags, updated_at`,
                [
                    description || null,
                    tags ? tags.split(',') : null,
                    id
                ]
            );
            
            if (result.rows.length === 0) {
                console.log('⚠️ Фото не найдено для обновления, ID:', id);
                return res.status(404).json({
                    success: false,
                    message: 'Photo not found'
                });
            }
            
            console.log('✅ Фото обновлено');

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Photo updated successfully'
            });
            
        } catch (error) {
            console.error('❌ Ошибка обновления фото:', error);
            res.status(500).json({
                success: false,
                message: 'Error updating photo'
            });
        }
    }
    
    // Удаление фото
    async deletePhoto(req, res) {
        try {
            const { id } = req.params;
            
            console.log('🗑️ Удаление фото ID:', id);

            const result = await db.query(
                'DELETE FROM photos WHERE id = $1 RETURNING id',
                [id]
            );
            
            if (result.rows.length === 0) {
                console.log('⚠️ Фото не найдено для удаления, ID:', id);
                return res.status(404).json({
                    success: false,
                    message: 'Photo not found'
                });
            }
            
            console.log('✅ Фото удалено');

            res.json({
                success: true,
                message: 'Photo deleted successfully'
            });
            
        } catch (error) {
            console.error('❌ Ошибка удаления фото:', error);
            res.status(500).json({
                success: false,
                message: 'Error deleting photo'
            });
        }
    }
    
    // Поиск по тегам
    async searchByTags(req, res) {
        try {
            const { tags } = req.query;
            
            console.log('🔎 Поиск по тегам:', tags);
            
            if (!tags || tags.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Tags parameter is required'
                });
            }
            
            const tagArray = tags.split(',').map(tag => tag.trim());
            
            const result = await db.query(
                `SELECT id, filename, mime_type, file_size, 
                created_at, description, tags 
                FROM photos 
                WHERE tags && $1 
                ORDER BY created_at DESC`,
                [tagArray]
            );
            
            console.log('✅ Найдено результатов:', result.rows.length);

            res.json({
                success: true,
                data: result.rows,
                count: result.rows.length
            });
            
        } catch (error) {
            console.error('❌ Ошибка поиска:', error);
            res.status(500).json({
                success: false,
                message: 'Error searching photos'
            });
        }
    }

    // Тестовый эндпоинт для проверки подключения
    async testConnection(req, res) {
        try {
            const result = await db.query('SELECT NOW() as time, version() as version');
            
            res.json({
                success: true,
                message: 'Database connection successful',
                data: result.rows[0]
            });
        } catch (error) {
            console.error('❌ Ошибка подключения к БД:', error);
            res.status(500).json({
                success: false,
                message: 'Database connection failed',
                error: error.message
            });
        }
    }
}

module.exports = new PhotoController();