const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const sharp = require('sharp');
const ProgressBar = require('progress');

class BulkUploader {
    constructor(config = {}) {
        this.config = {
            photosPath: config.photosPath || 'D:/photos',
            maxWidth: config.maxWidth || 1920,
            maxHeight: config.maxHeight || 1080,
            quality: config.quality || 85,
            batchSize: config.batchSize || 5,
            ...config
        };

        this.pool = new Pool({
            host: 'localhost',
            port: 5432,
            database: 'photo_gallery',
            user: 'gallery_app',
            password: '1812'  // Из .env файла
        });

        this.progressBar = null;
    }

    async processBatch(filePaths, batchNumber) {
        const batchResults = [];
        
        for (const filePath of filePaths) {
            try {
                const result = await this.processSingleFile(filePath);
                batchResults.push(result);
                
                if (this.progressBar) {
                    this.progressBar.tick();
                }
            } catch (error) {
                batchResults.push({
                    filePath,
                    success: false,
                    error: error.message
                });
                
                if (this.progressBar) {
                    this.progressBar.tick();
                }
            }
        }
        
        return batchResults;
    }

    async processSingleFile(filePath) {
        const filename = path.basename(filePath);
        const fileSize = fs.statSync(filePath).size;
        
        // Проверка на существование
        const exists = await this.checkIfExists(filename, fileSize);
        if (exists) {
            return { filePath, success: false, reason: 'Already exists', skipped: true };
        }
        
        // Обработка изображения
        const imageBuffer = fs.readFileSync(filePath);
        const processed = await this.optimizeImage(imageBuffer);
        
        if (!processed.success) {
            return { filePath, success: false, reason: 'Image processing failed' };
        }
        
        // Сохранение в БД
        try {
            await this.saveToDatabase(filename, processed);
            return { filePath, success: true, id: processed.dbId };
        } catch (error) {
            return { filePath, success: false, reason: error.message };
        }
    }

    async optimizeImage(buffer) {
        try {
            const image = sharp(buffer);
            const metadata = await image.metadata();
            
            let optimizedBuffer = buffer;
            let finalWidth = metadata.width;
            let finalHeight = metadata.height;
            
            // Ресайз если нужно
            if (metadata.width > this.config.maxWidth || metadata.height > this.config.maxHeight) {
                optimizedBuffer = await image
                    .resize(this.config.maxWidth, this.config.maxHeight, {
                        fit: 'inside',
                        withoutEnlargement: true
                    })
                    .jpeg({ quality: this.config.quality })
                    .toBuffer();
                
                const newMetadata = await sharp(optimizedBuffer).metadata();
                finalWidth = newMetadata.width;
                finalHeight = newMetadata.height;
            }
            
            return {
                success: true,
                buffer: optimizedBuffer,
                width: finalWidth,
                height: finalHeight,
                format: metadata.format,
                size: optimizedBuffer.length
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async checkIfExists(filename, fileSize) {
        const result = await this.pool.query(
            'SELECT 1 FROM photos WHERE filename = $1 AND file_size = $2 LIMIT 1',
            [filename, fileSize]
        );
        return result.rows.length > 0;
    }

    async saveToDatabase(filename, imageData) {
        const result = await this.pool.query(
            `INSERT INTO photos 
            (filename, image_data, mime_type, file_size, width, height) 
            VALUES ($1, $2, $3, $4, $5, $6) 
            RETURNING id`,
            [
                filename,
                imageData.buffer,
                `image/${imageData.format}`,
                imageData.size,
                imageData.width,
                imageData.height
            ]
        );
        
        return result.rows[0].id;
    }

    async getAllPhotoFiles() {
        const files = [];
        
        function walkDir(currentPath) {
            const items = fs.readdirSync(currentPath, { withFileTypes: true });
            
            for (const item of items) {
                const fullPath = path.join(currentPath, item.name);
                
                if (item.isDirectory()) {
                    walkDir(fullPath);
                } else if (item.isFile()) {
                    const ext = path.extname(item.name).toLowerCase();
                    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
                        files.push(fullPath);
                    }
                }
            }
        }
        
        walkDir(this.config.photosPath);
        return files;
    }

    async run() {
        console.log('📸 Bulk Photo Uploader');
        console.log('='.repeat(50));
        
        // Получаем список файлов
        console.log('🔍 Scanning for photos...');
        const allFiles = await this.getAllPhotoFiles();
        
        if (allFiles.length === 0) {
            console.log('❌ No photos found!');
            await this.pool.end();
            return;
        }
        
        console.log(`📊 Found ${allFiles.length} photos`);
        
        // Создаем прогресс-бар
        this.progressBar = new ProgressBar('[:bar] :percent :etas', {
            complete: '=',
            incomplete: ' ',
            width: 40,
            total: allFiles.length
        });
        
        // Обрабатываем батчами
        const results = {
            total: allFiles.length,
            success: 0,
            skipped: 0,
            failed: 0
        };
        
        for (let i = 0; i < allFiles.length; i += this.config.batchSize) {
            const batch = allFiles.slice(i, i + this.config.batchSize);
            const batchResults = await this.processBatch(batch, Math.floor(i / this.config.batchSize) + 1);
            
            batchResults.forEach(result => {
                if (result.success) results.success++;
                else if (result.skipped) results.skipped++;
                else results.failed++;
            });
        }
        
        // Вывод результатов
        console.log('\n' + '='.repeat(50));
        console.log('✅ Upload Complete!');
        console.log('📈 Results:');
        console.log(`   Successfully uploaded: ${results.success}`);
        console.log(`   Skipped (already exists): ${results.skipped}`);
        console.log(`   Failed: ${results.failed}`);
        console.log(`   Total processed: ${results.total}`);
        
        await this.pool.end();
    }
}

// ЗАПУСКАТЬ ТОЛЬКО ЕСЛИ ФАЙЛ ВЫЗВАН НАПРЯМУЮ
if (require.main === module) {
    const uploader = new BulkUploader({
        photosPath: process.argv[2] || 'D:/photos',
        maxWidth: 1920,
        maxHeight: 1080,
        quality: 85,
        batchSize: 5
    });

    uploader.run().catch(console.error);
}

module.exports = BulkUploader;