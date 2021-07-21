import * as fs from "fs";
import * as url from "url";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
import v8toIstanbul from "v8-to-istanbul";

export const loadCoverage = async (coverageFile: any) => {
  const data: string = fs.readFileSync(coverageFile, "utf8");

  const dataObject = JSON.parse(data);
  const coverage = dataObject.result;
  const sourceMap = dataObject["source-map-cache"];

  if (!sourceMap) {
    console.log("No source map found.");
    return null;
  }
  return {
    coverage,
    sourceMap,
  };
};

export const convertCoverage = async (
  coverage: any,
  sourceMap: any,
  target: any
) => {
  const sources: {
    sourceMap: any;
    source: any;
  } = {
    sourceMap: null,
    source: null,
  };
  const targetSourceMap = sourceMap[url.pathToFileURL(target).href];
  if (!targetSourceMap) return null;
  sources.sourceMap = {
    sourcemap: targetSourceMap.data,
  };
  let source = "";
  targetSourceMap.lineLengths.forEach((length: number) => {
    source += `${"".padEnd(length, ".")}\n`;
  });
  sources.source = source;
  const converter = v8toIstanbul(
    url.pathToFileURL(target).href,
    undefined,
    sources
  );
  await converter.load();

  const aabb = coverage.filter((r: any) => r.url.includes(target))[0].functions;

  converter.applyCoverage(aabb);
  const convertedCoverage = converter.toIstanbul();
  return convertedCoverage[path.resolve(target)];
};
