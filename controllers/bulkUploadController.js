const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const sharp = require('sharp');

class BulkUploadController {
    constructor() {
        this.pool = new Pool({
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME || 'photo_gallery',
            user: process.env.DB_USER || 'gallery_app',
            password: process.env.DB_PASSWORD || '1812'
        });
    }

    async uploadFromFolder(req, res) {
        try {
            const { folderPath = 'D:/photos' } = req.body;
            
            if (!fs.existsSync(folderPath)) {
                return res.status(400).json({
                    success: false,
                    message: `Folder ${folderPath} does not exist`
                });
            }

            this.processFolder(folderPath)
                .then(stats => {
                    console.log(' Bulk upload completed:', stats);
                })
                .catch(error => {
                    console.error(' Bulk upload failed:', error);
                });

            res.json({
                success: true,
                message: 'Bulk upload started in background',
                folder: folderPath,
                note: 'Check server logs for progress'
            });

        } catch (error) {
            console.error('Error starting bulk upload:', error);
            res.status(500).json({
                success: false,
                message: 'Error starting bulk upload',
                error: error.message
            });
        }
    }

    async processFolder(folderPath) {
        console.log(` Starting bulk upload from: ${folderPath}`);
        
        const files = this.getAllImageFiles(folderPath);
        console.log(` Found ${files.length} images to process`);

        if (files.length === 0) {
            return { message: 'No images found', total: 0 };
        }

        const stats = {
            total: files.length,
            uploaded: 0,
            skipped: 0,
            errors: 0,
            startTime: new Date()
        };

        for (let i = 0; i < files.length; i++) {
            const filePath = files[i];
            const filename = path.basename(filePath);
            const progress = ((i + 1) / files.length * 100).toFixed(1);

            console.log(`[${i + 1}/${files.length}] ${progress}% - ${filename}`);

            try {
                const result = await this.processSingleFile(filePath);
                if (result.success) {
                    stats.uploaded++;
                } else if (result.skipped) {
                    stats.skipped++;
                } else {
                    stats.errors++;
                }
            } catch (error) {
                console.error(`Error processing ${filename}:`, error.message);
                stats.errors++;
            }
        }

        stats.endTime = new Date();
        stats.duration = (stats.endTime - stats.startTime) / 1000;

        console.log('\n📊 Upload Statistics:');
        console.log(`   Total: ${stats.total}`);
        console.log(`   Uploaded: ${stats.uploaded}`);
        console.log(`   Skipped: ${stats.skipped}`);
        console.log(`   Errors: ${stats.errors}`);
        console.log(`   Duration: ${stats.duration.toFixed(2)}s`);

        return stats;
    }

    getAllImageFiles(dir) {
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
                console.error(`Error scanning ${currentPath}:`, error.message);
            }
        }

        scanDirectory(dir);
        return imageFiles;
    }

    async processSingleFile(filePath) {
        const filename = path.basename(filePath);
        
        try {
            const stats = fs.statSync(filePath);
            if (stats.size > 50 * 1024 * 1024) { 
                console.log(`   Skipping ${filename} - too large (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
                return { success: false, skipped: true, reason: 'File too large' };
            }


            const exists = await this.checkIfExists(filename, stats.size);
            if (exists) {
                console.log(`   Skipping ${filename} - already exists`);
                return { success: false, skipped: true, reason: 'Already exists' };
            }


            const buffer = fs.readFileSync(filePath);
            const processed = await this.optimizeImage(buffer);
            
            if (!processed.success) {
                return { success: false, reason: 'Image processing failed' };
            }

            const mimeType = this.getMimeType(filePath);

            const result = await this.pool.query(
                `INSERT INTO photos 
                (filename, image_data, mime_type, file_size, width, height, description) 
                VALUES ($1, $2, $3, $4, $5, $6, $7) 
                RETURNING id`,
                [
                    filename,
                    processed.buffer,
                    mimeType,
                    processed.buffer.length,
                    processed.width,
                    processed.height,
                    `Uploaded from ${filePath}`
                ]
            );

            console.log(`    Uploaded: ${filename} (ID: ${result.rows[0].id})`);
            return { success: true, id: result.rows[0].id };

        } catch (error) {
            console.error(`    Error uploading ${filename}:`, error.message);
            return { success: false, reason: error.message };
        }
    }

    async checkIfExists(filename, fileSize) {
        try {
            const result = await this.pool.query(
                'SELECT 1 FROM photos WHERE filename = $1 AND file_size = $2 LIMIT 1',
                [filename, fileSize]
            );
            return result.rows.length > 0;
        } catch (error) {
            return false;
        }
    }

    async optimizeImage(buffer) {
        try {
            const image = sharp(buffer);
            const metadata = await image.metadata();
            
            let optimizedBuffer = buffer;
            const maxDimension = 1920;


            if (metadata.width > maxDimension || metadata.height > maxDimension) {
                optimizedBuffer = await image
                    .resize(maxDimension, maxDimension, {
                        fit: 'inside',
                        withoutEnlargement: true
                    })
                    .jpeg({ quality: 85 })
                    .toBuffer();
                
                const newMetadata = await sharp(optimizedBuffer).metadata();
                return {
                    success: true,
                    buffer: optimizedBuffer,
                    width: newMetadata.width,
                    height: newMetadata.height
                };
            }

            return {
                success: true,
                buffer: optimizedBuffer,
                width: metadata.width,
                height: metadata.height
            };

        } catch (error) {
            console.error('Image optimization error:', error.message);
            return { success: false, error: error.message };
        }
    }

    getMimeType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.bmp': 'image/bmp'
        };
        return mimeTypes[ext] || 'image/jpeg';
    }
}

module.exports = new BulkUploadController();