const sharp = require('sharp');

class ImageProcessor {
    constructor() {
        this.supportedFormats = ['jpeg', 'jpg', 'png', 'webp', 'gif', 'tiff'];
    }

    async validateImage(buffer) {
        try {
            const metadata = await sharp(buffer).metadata();
            return {
                isValid: true,
                metadata: metadata,
                format: metadata.format,
                width: metadata.width,
                height: metadata.height,
                size: metadata.size || buffer.length
            };
        } catch (error) {
            return {
                isValid: false,
                error: 'Invalid image file'
            };
        }
    }

    async resizeImage(buffer, options = {}) {
        const {
            maxWidth = 2000,
            maxHeight = 2000,
            quality = 85,
            format = 'jpeg'
        } = options;

        try {
            let processor = sharp(buffer);

            const metadata = await processor.metadata();

            const needsResize = metadata.width > maxWidth || metadata.height > maxHeight;

            if (needsResize) {
                processor = processor.resize(maxWidth, maxHeight, {
                    fit: 'inside',
                    withoutEnlargement: true
                });
            }

            switch (format.toLowerCase()) {
                case 'jpeg':
                case 'jpg':
                    processor = processor.jpeg({ quality });
                    break;
                case 'png':
                    processor = processor.png({ quality });
                    break;
                case 'webp':
                    processor = processor.webp({ quality });
                    break;
                default:
                    processor = processor.jpeg({ quality });
            }

            const processedBuffer = await processor.toBuffer();
            
            return {
                success: true,
                buffer: processedBuffer,
                originalSize: buffer.length,
                processedSize: processedBuffer.length,
                reduction: ((buffer.length - processedBuffer.length) / buffer.length * 100).toFixed(2),
                width: metadata.width,
                height: metadata.height,
                finalWidth: needsResize ? Math.min(metadata.width, maxWidth) : metadata.width,
                finalHeight: needsResize ? Math.min(metadata.height, maxHeight) : metadata.height
            };

        } catch (error) {
            console.error('Image processing error:', error);
            return {
                success: false,
                error: error.message,
                buffer: buffer
            };
        }
    }

    async createThumbnail(buffer, options = {}) {
        const {
            width = 200,
            height = 200,
            quality = 80,
            format = 'jpeg'
        } = options;

        try {
            const thumbnailBuffer = await sharp(buffer)
                .resize(width, height, {
                    fit: 'cover',
                    position: 'center'
                })
                .toFormat(format, { quality })
                .toBuffer();

            return {
                success: true,
                buffer: thumbnailBuffer,
                width,
                height,
                format,
                size: thumbnailBuffer.length
            };

        } catch (error) {
            console.error('Thumbnail creation error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async extractExifData(buffer) {
        try {
            const metadata = await sharp(buffer).metadata();
            
            const exif = {
                width: metadata.width,
                height: metadata.height,
                format: metadata.format,
                space: metadata.space,
                channels: metadata.channels,
                density: metadata.density,
                hasAlpha: metadata.hasAlpha,
                orientation: metadata.orientation
            };

            if (metadata.exif) {
                exif.exif = metadata.exif;
            }

            return exif;

        } catch (error) {
            console.warn('EXIF extraction error:', error.message);
            return null;
        }
    }

    async convertFormat(buffer, targetFormat, quality = 85) {
        try {
            let processor = sharp(buffer);

            switch (targetFormat.toLowerCase()) {
                case 'jpeg':
                case 'jpg':
                    processor = processor.jpeg({ quality });
                    break;
                case 'png':
                    processor = processor.png({ quality });
                    break;
                case 'webp':
                    processor = processor.webp({ quality });
                    break;
                default:
                    throw new Error(`Unsupported format: ${targetFormat}`);
            }

            const convertedBuffer = await processor.toBuffer();
            
            return {
                success: true,
                buffer: convertedBuffer,
                format: targetFormat,
                size: convertedBuffer.length
            };

        } catch (error) {
            console.error('Format conversion error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = new ImageProcessor();