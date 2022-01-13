import { PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { HttpError } from '@errors/http/http-error';
import { log } from '@helper/logger';
import axios from 'axios';
import * as Sharp from 'sharp';
import { getEnv } from '@helper/environment';
import { S3Service } from '@services/s3.service';
import { ddbClient } from '@services/ddbClient';
import * as sstk from 'shutterstock-api';
import { ShutterstockSearchParameters, ShutterstockImage } from './shutterstock.interface';

sstk.setAccessToken(`${getEnv('SHUTTERSTOCK_TOCKEN')}`);

export class ShutterstockService {
  private imagesApi: sstk.ImagesApi;
  private S3: S3Service = new S3Service();
  private galleryTable: string = getEnv('GALLERY_TABLE');
  private galleryBucket: string = getEnv('GALLERY_BUCKET');
  private subclipsBucket: string = getEnv('SUBCLIPS_BUCKET');

  constructor() {
    this.imagesApi = new sstk.ImagesApi();
  }

  async findImages(query: ShutterstockSearchParameters): Promise<Array<ShutterstockImage>> {
    const reply = await this.imagesApi.searchImages(query);
    if (!reply.data) {
      throw new HttpError(500, 'request failed', 'Request to Shutterstock API failed');
    }
    return reply.data.map((elem) => {
      return {
        id: elem.id,
        url: elem.assets.huge_thumb.url,
        contributor_id: elem.contributor.id,
        description: elem.description,
        image_type: elem.image_type,
        media_type: elem.media_type,
      };
    });
  }

  // async saveOriginalImageToS3(image: ShutterstockImage, user: string): Promise<void> {
  //   const response = await axios.get(image.url, { responseType: 'arraybuffer' });
  //   const buffer = Buffer.from(response.data, 'utf-8');
  //   log('saving original image to GALLERY_BUCKET');
  //   await this.S3.put(`shutterstock/${user}/shutterstock_${image.id}`, buffer.toString(), this.galleryBucket);
  //   await this.presaveImageToDynamoDB(image, user);
  //   return;
  // }
  async saveOriginalImageToS3(image: ShutterstockImage): Promise<void> {
    const response = await axios.get(image.url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'utf-8');
    log('saving original image to GALLERY_BUCKET');
    await this.S3.put(`shutterstock/${image.user}/shutterstock_${image.id}`, buffer.toString(), this.galleryBucket);
    await this.presaveImageToDynamoDB(image, image.user!);
    return;
  }

  async presaveImageToDynamoDB(image: ShutterstockImage, user: string): Promise<void> {
    const s3link: string = this.S3.getPreSignedGetUrl(
      `shutterstock/${user}/shutterstock_${image.id}`,
      this.galleryBucket
    );
    log(`Saving ${image.id} to ${this.galleryTable}`);
    const params = {
      TableName: this.galleryTable,
      Item: {
        email: { S: user },
        user_data: { S: `image_${image.id}` },
        status: { S: 'open' },
        s3link: { S: `${s3link}` },
        contributor_id: { S: image.contributor_id },
        description: { S: image.description },
        image_type: { S: image.image_type },
        media_type: { S: image.media_type },
        subclipCreated: { BOOL: false },
      },
    };

    const result = await ddbClient.send(new PutItemCommand(params));
    log(result);
    return;
  }

  async updateImageStatusDynamoDB(image: ShutterstockImage, user: string): Promise<void> {
    const params = {
      TableName: this.galleryTable,
      Key: {
        email: { S: user },
        user_data: { S: `image_${image.id}` },
      },
      UpdateExpression: 'SET #status = :st',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':st': { S: 'closed' },
      },
    };

    const dynamoReply = await ddbClient.send(new UpdateItemCommand(params));
    log(dynamoReply);
  }

  async createSubclip(key: string): Promise<void> {
    const originalImage = await this.S3.get(key, this.galleryBucket);
    const subclipBuffer = await Sharp(originalImage.Body).resize(512, 250).toBuffer();
    log('saving image to SUBCLIPS_BUCKET');
    await this.S3.put(key, subclipBuffer, this.subclipsBucket);
  }

  async updateImageSubclipCreated(image_id: string, user: string): Promise<void> {
    const params = {
      TableName: this.galleryTable,
      Key: {
        email: { S: user },
        user_data: { S: `image_${image_id}` },
      },
      UpdateExpression: 'SET #subclipCreated = :sbc',
      ExpressionAttributeNames: {
        '#subclipCreated': 'subclipCreated',
      },
      ExpressionAttributeValues: {
        ':sbc': { BOOL: true },
      },
    };

    const dynamoReply = await ddbClient.send(new UpdateItemCommand(params));
  }
}
