import { interpolate, Config, secret } from "@pulumi/pulumi";
import { local, remote, types } from "@pulumi/command";
import * as aws from "@pulumi/aws";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { size } from "./size";

const config = new Config();
const keyName = config.get("keyName") ?? new aws.ec2.KeyPair("key", { publicKey: config.require("publicKey") }).keyName;
const privateKeyBase64 = config.get("privateKeyBase64");
const privateKey = privateKeyBase64 ? Buffer.from(privateKeyBase64, 'base64').toString('ascii') : fs.readFileSync(path.join(os.homedir(), ".ssh", "id_rsa")).toString("utf8");

const secgrp = new aws.ec2.SecurityGroup("secgrp", {
    description: "Foo",
    ingress: [
        { protocol: "tcp", fromPort: 22, toPort: 22, cidrBlocks: ["0.0.0.0/0"] },
        { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] },
    ],
});

const ami = aws.ec2.getAmiOutput({
    owners: ["amazon"],
    mostRecent: true,
    filters: [{
        name: "name",
        values: ["amzn-ami-hvm-*-x86_64-gp2"],
    }],
});

const server = new aws.ec2.Instance("server", {
    instanceType: size,
    ami: ami.id,
    keyName: keyName,
    vpcSecurityGroupIds: [secgrp.id],
}, { replaceOnChanges: ["instanceType"] });

const connection: types.input.remote.ConnectionArgs = {
    host: server.publicIp,
    user: "ec2-user",
    privateKey: privateKey,
};

const connectionNoDialRetry: types.input.remote.ConnectionArgs = {
    host: server.publicIp,
    user: "ec2-user",
    privateKey: privateKey,
    dialErrorLimit: -1,
};

const hostname = new remote.Command("hostname", {
    connection,
    create: "hostname",
    environment: secret({
      "secret-key": secret("super-secret-value")
    }),
});

new remote.Command("remotePrivateIP", {
    connection,
    create: interpolate`echo ${server.privateIp} > private_ip.txt`,
    delete: `rm private_ip.txt`,
}, { deleteBeforeReplace: true });

new remote.Command("remoteWithNoDialRetryPrivateIP", {
    connection: connectionNoDialRetry,
    create: interpolate`echo ${server.privateIp} > private_ip_on_no_dial_retry.txt`,
    delete: `rm private_ip_on_no_dial_retry.txt`,
}, { deleteBeforeReplace: true });

new local.Command("localPrivateIP", {
    create: interpolate`echo ${server.privateIp} > private_ip.txt`,
    delete: `rm private_ip.txt`,
}, { deleteBeforeReplace: true });

const sizeFile = new remote.CopyFile("size", {
    connection,
    localPath: "./size.ts",
    remotePath: "size.ts",
})

const catSize = new remote.Command("checkSize", {
    connection,
    create: "cat size.ts",
}, { dependsOn: sizeFile })

export const connectionSecret = hostname.connection;
export const secretEnv = hostname.environment;
export const confirmSize = catSize.stdout;
export const publicIp = server.publicIp;
export const publicHostName = server.publicDns;
export const hostnameStdout = hostname.stdout;
