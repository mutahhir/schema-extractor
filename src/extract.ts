import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";

function spawnTerraformSchema(cwd: string) {
  return new Promise<string>(async (resolve, reject) => {
    const tf = spawn("terraform", ["providers", "schema", "-json"], { cwd });

    let data: string[] = [];
    tf.stdout.on("data", (chunk) => {
      data.push(chunk);
    });

    tf.stdout.on("close", (chunk: string) => {
      if (chunk) {
        data.push(chunk);
      }

      resolve(data.join(""));
    });

    let errorData: string[] = [];
    tf.stderr.on("data", (chunk) => {
      data.push(chunk);
    });
    tf.stderr.on("close", (chunk: any) => {
      if (chunk) {
        errorData.push(chunk);
      }

      if (errorData.length > 0) {
        return reject(errorData.join(""));
      }
    });

    tf.on("close", (code) => {
      if (code !== 0) {
        reject(`cdktf exited with code ${code}`);
      } else {
        resolve("");
      }
    });

    tf.on("error", (err) => {
      console.log("Error while spawning cdktf: " + err);
      reject(err);
    });
  });
}

function spawnTerraformInit(cwd: string) {
  return new Promise<void>(async (resolve, reject) => {
    const tf = spawn("terraform", ["init"], {
      cwd,
    });

    tf.on("close", (code) => {
      if (code !== 0) {
        reject(`terraform exited with code ${code}`);
      } else {
        resolve();
      }
    });

    tf.on("error", (err) => {
      console.log("Error while spawning cdktf: " + err);
      reject(err);
    });
  });
}

function getFullProviderName(providerName: string) {
  const parts = providerName.split("/");
  if (parts.length === 2) {
    return providerName;
  } else return `hashicorp/${providerName}`;
}

async function getLatestVersion(providerName: string) {
  const name = getFullProviderName(providerName);

  const response = await fetch(
    `https://registry.terraform.io/v1/providers/${name}`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch provider ${name}`);
  }

  const data = await response.json();

  return data.version;
}

async function getProviderInformation(providerName: string, version: string) {
  if (!version) {
    version = await getLatestVersion(providerName);
  }

  const fullName = getFullProviderName(providerName);
  return {
    alias: fullName.split("/")[1],
    name: fullName,
    version: version,
  };
}

export async function extract(
  providerName: string,
  version: string,
  resources: string[] = [],
  dataSources: string[] = [],
  outFile: string = ""
) {
  const tfFolder = await fs.mkdtemp("tf-");
  try {
    const tfFile = path.join(tfFolder, "main.tf");
    const providerInfo = await getProviderInformation(providerName, version);

    await fs.writeFile(
      tfFile,
      `
    terraform {
        required_providers {
            ${providerInfo.alias}= {
            source = "${providerInfo.name}"
            version = "${providerInfo.version}"
            }
        }
    }
    `,
      "utf-8"
    );

    await spawnTerraformInit(tfFolder);
    const schema = await spawnTerraformSchema(tfFolder);

    const parsedSchema = JSON.parse(schema);

    const { provider_schemas, format_version } = parsedSchema;
    const providerSchemaName = Object.keys(provider_schemas)[0];
    const { resource_schemas, data_source_schemas } =
      provider_schemas[providerSchemaName];

    let trimmedResourceSchemas: any = {};
    let trimmedDataSourceSchemas: any = {};

    if (resources.length === 1 && resources[0] === "*") {
      trimmedResourceSchemas = resource_schemas;
    } else {
      for (var resource of resources) {
        trimmedResourceSchemas[resource] = resource_schemas[resource];
      }
    }

    if (Object.keys(trimmedResourceSchemas).length === 0) {
      throw new Error("No resources found with filter: " + resources.join(" || "));
    }

    if (dataSources.length === 1 && dataSources[0] === "*") {
      trimmedDataSourceSchemas = data_source_schemas;
    } else {
      for (var dataSource of dataSources) {
        trimmedDataSourceSchemas[dataSource] = data_source_schemas[dataSource];
      }
    }

    if (Object.keys(trimmedDataSourceSchemas).length === 0) {
      throw new Error("No data sources found with filter: " + dataSources.join(" || "));
    }

    const trimmedSchema = {
      format_version,
      provider_schemas: {
        [providerSchemaName]: {
          provider: {},
          resource_schemas: trimmedResourceSchemas,
          data_source_schemas: trimmedDataSourceSchemas,
        },
      },
    };

    if (outFile) {
      await fs.writeFile(outFile, JSON.stringify(trimmedSchema), "utf-8");
    } else {
      console.log(JSON.stringify(trimmedSchema, null, 2));
    }
  } catch (e) {
    console.error("Error: ", e);
  } finally {
    // Clean up
    fs.rm(tfFolder, { recursive: true });
  }

  return {};
}
