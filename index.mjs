import { EC2Client, RunInstancesCommand } from "@aws-sdk/client-ec2";
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import fs from "fs";
const config = JSON.parse(fs.readFileSync("./config.json").toString())
const s3 = new S3Client(config.aws);
const ec2 = new EC2Client(config.aws);
import {
    SecretsManagerClient,
    GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

export const handler = async(event) => {

    //  load configuration from AWS Secrets Manager
    const client = new SecretsManagerClient(config.aws);
    let response;
    try {
        response = await client.send(
            new GetSecretValueCommand({
                SecretId: config.secret
            })
        );
    } catch (error) {
        throw error;
    }
    const secret = JSON.parse(response.SecretString);

    //  compare latest compiled build hash with latest rotmg build hash
    if ( secret.compareHashes === "true" ) {
        const buildinfo = await GetS3Object(secret.s3_bucket, secret.buildInfoS3, 'json')
        secret.buildhash = buildinfo.buildhash
        if (buildinfo.buildhash === buildinfo.compiledhash && secret.force !== "true") {
            return {
                statusCode: 200,
                body: "no update detected"
            }
        }
    }

    //  prepare EC2 instance UserData
    let userData = (await fs.promises.readFile("./user-data.sh")).toString()
    Object.keys(secret).forEach(function(key) {
        const regex = new RegExp(`\\[\\[${key}\\]\\]`, "g");
        userData = userData.replace(regex, secret[key]);
    })

    let macLocation = secret.macLocation.match(/^(s3|http)s?:\/\/(.*)$/)
    let buildsteps
    if ( macLocation[1] === "s3" ) {

        //  this should be a zip file located in s3
        let file = macLocation[2].match(/\/([a-zA-Z0-9-.]*)$/)
        buildsteps = "mkdir muledump-asset-compiler &&\n" +
            "cd muledump-asset-compiler &&" +
            "aws --profile awsprofile s3 cp " + secret.macLocation + " . &&\n" +
            "unzip " + file[1] + " &&\n"

    } else if ( macLocation[1] === "http" ) {

        //  this should be a git repo
        buildsteps = "git clone " + secret.macLocation + " &&" +
            "cd muledump-asset-compiler &&\n"

    }

    if ( !buildsteps ) return {
        statusCode: 500,
        Body: "no valid macLocation found"
    }

    userData = userData.replace("[[buildsteps]]", buildsteps)

    //  prepare EC2 instance configuration
    const runInstancesConfig = await GetS3Object(secret.s3_bucket, secret.runInstancesPath, 'json')
    runInstancesConfig.UserData = Buffer.from(userData).toString('base64');

    //  send api command
    const command = new RunInstancesCommand(runInstancesConfig);
    await ec2.send(command);

    return {
        statusCode: 200,
        body: JSON.stringify('ok'),
    };

};

async function GetS3Object(bucket, key, type='plain') {

    const s3Promise = await s3.send(new GetObjectCommand({
        "Bucket": bucket,
        "Key": key
    }))
    const s3Object = await s3Promise.Body.transformToString()
    if ( !s3Object ) return
    if ( type === 'json' ) return JSON.parse(s3Object)
    return s3Object

}
