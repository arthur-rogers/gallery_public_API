import { HttpBadRequestError } from '@errors/http';
import { log } from '@helper/logger';
import * as crypto from 'crypto';
import { AuthenticationResponse, SignUpResponse } from './auth.interface';
import { UserCredentials } from '@interfaces/user-credentials.interface';
import { LoginService } from './auth.service';
import { getEnv } from '@helper/environment';
// import { ddbClient } from '@services/ddbClient';
import { DynamoClient } from '@services/ddbClient';
import { GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

export class LoginManager {
  private readonly service: LoginService;
  private dynamoClient: DynamoClient;
  constructor() {
    this.service = new LoginService();
    this.dynamoClient = new DynamoClient();
  }

  encryptUsersPassword(pw: string): string {
    return crypto.createHmac('sha256', getEnv('PASSWORD_ENC_KEY')).update(pw).digest('hex');
  }

  async checkUserAndSignJWT(user: UserCredentials): Promise<AuthenticationResponse> {
    if (!user) {
      throw new Error('User not defined');
    }

    if (await this.checkUserPresenceInDB(user)) {
      return this.service.signJWTToken(user.email);
    } else throw new HttpBadRequestError('Invalid credentials');
  }

  async signUp(user: UserCredentials): Promise<SignUpResponse> {
    log('sign up manager started');
    log(user);
    const hashedPass = this.encryptUsersPassword(user.password);
    return this.service.signUp(user.email, hashedPass);
  }

  async checkUserPresenceInDB(userData: UserCredentials): Promise<boolean | undefined> {
    // const params = {
    //   TableName: getEnv('GALLERY_TABLE'),
    //   Key: {
    //     email: { S: userData.email },
    //     user_data: { S: 'user' },
    //   },
    // };

    const hashedPassword = crypto
      .createHmac('sha256', getEnv('PASSWORD_ENC_KEY'))
      .update(userData.password)
      .digest('hex');
    const userDB = await this.dynamoClient.checkUserPresenceInDB(userData.email);
    const userDBUnmarshalled = unmarshall(userDB.Item!);

    return userDB.Item && hashedPassword == userDBUnmarshalled.passwordHash;
  }
}
