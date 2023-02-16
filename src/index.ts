import yargs from "yargs";
import { extract } from "./extract";

(async () => {
  const out = await yargs(process.argv.slice(2))
    .scriptName("schema-extractor")
    .usage("Usage: $0 [options]")
    .options({
      provider: {
        alias: "p",
        type: "string",
        demandOption: true,
        description:
          "Provider name, e.g. aws. Adds hashicorp if namespace not provided.",
      },
      providerVersion: {
        alias: "v",
        type: "string",
        description: "The version of the provider to use. Defaults to latest.",
      },
      resources: {
        alias: "r",
        type: "array",
        description:
          "The resources to extract. Defaults to none. Required either this or data.",
      },
      data: {
        alias: "d",
        type: "array",
        description:
          "The data sources to extract. Defaults to none. Required either this or data.",
      },
      out: {
        alias: "o",
        type: "string",
        description: "The output file. Defaults to stdout.",
      },
    })
    .check((argv) => {
      if (!argv.resources && !argv.data) {
        throw new Error(
          "Please provide at least one resource or data to extract"
        );
      }
      return true;
    }).argv;

  const resources = out.resources || [];
  const data = out.data || [];
  await extract(
    out.provider,
    out.providerVersion || "",
    resources as string[],
    data as string[],
    out.out || ""
  );
})();
