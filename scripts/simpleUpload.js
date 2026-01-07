const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function uploadPhotos(folderPath) {
    console.log('🚀 Начало загрузки фотографий из:', folderPath);
    
    const pool = new Pool({
        host: 'localhost',
        port: 5432,
        database: 'photo_gallery',
        user: 'gallery_app',
        password: '1812'
    });

    try {
        // Находим все изображения
        const imageFiles = [];
        const supportedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

        function scanDirectory(currentPath) {
            try {
                const items = fs.readdirSync(currentPath, { withFileTypes: true });
                
                for (const item of items) {
                    const fullPath = path.join(currentPath, item.name);
                    
                    if (item.isDirectory()) {
                        scanDirectory(fullPath);
                    } else if (item.isFile()) {
                        const ext = path.extname(item.name).toLowerCase();
                        if (supportedExtensions.includes(ext)) {
                            imageFiles.push(fullPath);
                        }
                    }
                }
            } catch (error) {
                console.error(`Ошибка сканирования ${currentPath}:`, error.message);
            }
        }

        scanDirectory(folderPath);
        console.log(`📊 Найдено ${imageFiles.length} изображений`);

        if (imageFiles.length === 0) {
            console.log('❌ Изображения не найдены');
            return;
        }

        // Обрабатываем каждое изображение
        let uploaded = 0;
        let errors = 0;
        let skipped = 0;

        for (let i = 0; i < imageFiles.length; i++) {
            const filePath = imageFiles[i];
            const filename = path.basename(filePath);
            const progress = ((i + 1) / imageFiles.length * 100).toFixed(1);
            
            process.stdout.write(`\r[${i + 1}/${imageFiles.length}] ${progress}% - ${filename}`);

            try {
                // Проверяем размер файла
                const stats = fs.statSync(filePath);
                if (stats.size > 50 * 1024 * 1024) { // 50MB лимит
                    console.log(`\n   ⚠️  Пропуск ${filename} - слишком большой (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
                    skipped++;
                    continue;
                }

                // Проверяем, существует ли уже в базе
                const existsResult = await pool.query(
                    'SELECT 1 FROM photos WHERE filename = $1 AND file_size = $2 LIMIT 1',
                    [filename, stats.size]
                );

                if (existsResult.rows.length > 0) {
                    console.log(`\n   ⚠️  Пропуск ${filename} - уже существует в базе`);
                    skipped++;
                    continue;
                }

                // Читаем файл
                const buffer = fs.readFileSync(filePath);
                
                // Определяем MIME тип
                const ext = path.extname(filename).toLowerCase();
                const mimeTypes = {
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.png': 'image/png',
                    '.gif': 'image/gif',
                    '.webp': 'image/webp',
                    '.bmp': 'image/bmp'
                };
                const mimeType = mimeTypes[ext] || 'image/jpeg';

                // Вставляем в базу
                await pool.query(
                    `INSERT INTO photos (filename, image_data, mime_type, file_size, description) 
                     VALUES ($1, $2, $3, $4, $5)`,
                    [filename, buffer, mimeType, stats.size, `Загружено из ${filePath}`]
                );

                uploaded++;
                console.log(`\n   ✅ Загружено: ${filename}`);

            } catch (error) {
                console.log(`\n   ❌ Ошибка с ${filename}:`, error.message);
                errors++;
            }
        }

        console.log('\n\n' + '='.repeat(50));
        console.log('✅ Загрузка завершена!');
        console.log('📊 Результаты:');
        console.log(`   Загружено: ${uploaded}`);
        console.log(`   Пропущено: ${skipped}`);
        console.log(`   Ошибок: ${errors}`);
        console.log(`   Всего: ${imageFiles.length}`);

    } catch (error) {
        console.error('\n❌ Фатальная ошибка:', error);
    } finally {
        await pool.end();
    }
}

// Запуск
const folderPath = process.argv[2] || 'D:/photos';

if (!fs.existsSync(folderPath)) {
    console.error(`❌ Папка "${folderPath}" не существует!`);
    console.log('Использование: node scripts/simpleUpload.js [путь_к_папке]');
    process.exit(1);
}

uploadPhotos(folderPath).catch(console.error);