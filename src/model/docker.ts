import { execWithErrorCheck } from './exec-with-error-check';
import ImageEnvironmentFactory from './image-environment-factory';
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ExecOptions, exec } from '@actions/exec';
import { DockerParameters, StringKeyValuePair } from './shared-types';
import core from '@actions/core';

class Docker {
  static async run(
    image: string,
    parameters: DockerParameters,
    silent: boolean = false,
    overrideCommands: string = '',
    additionalVariables: StringKeyValuePair[] = [],
    // eslint-disable-next-line unicorn/no-useless-undefined
    options: ExecOptions | undefined = undefined,
    entrypointBash: boolean = false,
    errorWhenMissingUnityBuildResults: boolean = true,
  ) {
    let runCommand = '';
    switch (process.platform) {
      case 'linux':
        runCommand = this.getLinuxCommand(image, parameters, overrideCommands, additionalVariables, entrypointBash);
        break;
      case 'win32':
        runCommand = this.getWindowsCommand(image, parameters);
    }
    if (options) {
      options.silent = silent;
      await execWithErrorCheck(runCommand, undefined, options, errorWhenMissingUnityBuildResults);
    } else {
      await execWithErrorCheck(runCommand, undefined, { silent }, errorWhenMissingUnityBuildResults);
    }
  }

  static getLinuxCommand(
    image: string,
    parameters: DockerParameters,
    overrideCommands: string = '',
    additionalVariables: StringKeyValuePair[] = [],
    entrypointBash: boolean = false,
  ): string {
    const { workspace, actionFolder, runnerTempPath, sshAgent, gitPrivateToken, dockerWorkspacePath } = parameters;

    const githubHome = path.join(runnerTempPath, '_github_home');
    if (!existsSync(githubHome)) mkdirSync(githubHome);
    const githubWorkflow = path.join(runnerTempPath, '_github_workflow');
    if (!existsSync(githubWorkflow)) mkdirSync(githubWorkflow);
    const commandPrefix = image === `alpine` ? `/bin/sh` : `/bin/bash`;

    const newActionFolder = this.copyPathWithReplacement(actionFolder);
    exec(`ls -l ${newActionFolder}`);

    return `docker run \
            --workdir ${dockerWorkspacePath} \
            --rm \
            ${ImageEnvironmentFactory.getEnvVarString(parameters, additionalVariables)} \
            --env UNITY_SERIAL \
            --env GITHUB_WORKSPACE=${dockerWorkspacePath} \
            ${gitPrivateToken ? `--env GIT_PRIVATE_TOKEN="${gitPrivateToken}"` : ''} \
            ${sshAgent ? '--env SSH_AUTH_SOCK=/ssh-agent' : ''} \
            --volume "${githubHome}":"/root:z" \
            --volume "${githubWorkflow}":"/github/workflow:z" \
            --volume "${workspace}":"${dockerWorkspacePath}:z" \
            --volume "${newActionFolder}/default-build-script:/UnityBuilderAction:z" \
            --volume "${newActionFolder}/platforms/ubuntu/steps:/steps:z" \
            --volume "${newActionFolder}/platforms/ubuntu/entrypoint.sh:/entrypoint.sh:z" \
            --volume "${newActionFolder}/unity-config:/usr/share/unity3d/config/:z" \
            ${sshAgent ? `--volume ${sshAgent}:/ssh-agent` : ''} \
            ${sshAgent ? '--volume /home/runner/.ssh/known_hosts:/root/.ssh/known_hosts:ro' : ''} \
            ${entrypointBash ? `--entrypoint ${commandPrefix}` : ``} \
            ${image} \
            ${entrypointBash ? `-c` : `${commandPrefix} -c`} \
            "${overrideCommands !== '' ? overrideCommands : `/entrypoint.sh`}"`;
  }

  static getWindowsCommand(image: string, parameters: DockerParameters): string {
    const { workspace, actionFolder, unitySerial, gitPrivateToken, dockerWorkspacePath } = parameters;

    return `docker run \
            --workdir c:${dockerWorkspacePath} \
            --rm \
            ${ImageEnvironmentFactory.getEnvVarString(parameters)} \
            --env UNITY_SERIAL="${unitySerial}" \
            --env GITHUB_WORKSPACE=c:${dockerWorkspacePath} \
            ${gitPrivateToken ? `--env GIT_PRIVATE_TOKEN="${gitPrivateToken}"` : ''} \
            --volume "${workspace}":"c:${dockerWorkspacePath}" \
            --volume "c:/regkeys":"c:/regkeys" \
            --volume "C:/Program Files (x86)/Microsoft Visual Studio":"C:/Program Files (x86)/Microsoft Visual Studio" \
            --volume "C:/Program Files (x86)/Windows Kits":"C:/Program Files (x86)/Windows Kits" \
            --volume "C:/ProgramData/Microsoft/VisualStudio":"C:/ProgramData/Microsoft/VisualStudio" \
            --volume "${actionFolder}/default-build-script":"c:/UnityBuilderAction" \
            --volume "${actionFolder}/platforms/windows":"c:/steps" \
            --volume "${actionFolder}/BlankProject":"c:/BlankProject" \
            ${image} \
            powershell c:/steps/entrypoint.ps1`;
  }

  static copyPathWithReplacement(originalPath: string) {
    if (originalPath.includes('@')) {
      const replacedPath = originalPath.replace('@', '-'); // 替换 @ 字符
      if (!existsSync(replacedPath)) mkdirSync(replacedPath, { recursive: true });
      Docker.copyDir(originalPath, replacedPath);
      originalPath = replacedPath;
    }

    return originalPath;
  }

  static copyDir(sourcePath_: string, destinationPath_: string) {
    // 读取源目录内容
    const files = readdirSync(sourcePath_);

    // 逐个处理源目录下的文件和子目录
    for (const file of files) {
      const sourcePath = path.join(sourcePath_, file);
      const destinationPath = path.join(destinationPath_, file);

      // 判断文件类型
      const stats = statSync(sourcePath);
      if (stats.isDirectory()) {
        // 如果是子目录，递归调用拷贝目录函数
        if (!existsSync(destinationPath)) mkdirSync(destinationPath, { recursive: true });
        Docker.copyDir(sourcePath, destinationPath);
      } else {
        // 如果是文件，直接拷贝文件
        copyFileSync(sourcePath, destinationPath);
        core.debug(`copy ${sourcePath} to ${destinationPath}`);
      }
    }
  }
}

export default Docker;
