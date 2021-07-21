import * as childProcess from "child_process";
import * as fs from "fs";
import { convertCoverage, loadCoverage } from "./coverageConverter";
import { Diff, Repository } from "nodegit";
import { IncomingMessage } from "http";
import { request, RequestOptions } from "https";
import FormData from "form-data";
import { FaultLocalizations } from "./FaultLocalizations";
import { ExecException } from "child_process";

console.log("hooks file loaded");

const addCommentsToFaultyFilesOnMergeRequest = (
  faultLocalizations: FaultLocalizations,
  gitlabApiToken: string
) => {
  const comment = faultLocalizations.generateComment();
  const form = new FormData();
  form.append("body", comment);

  const url = new URL(
    process.env.CI_API_V4_URL +
      "/projects/" +
      process.env.CI_PROJECT_ID +
      "/merge_requests/" +
      process.env.CI_MERGE_REQUEST_IID +
      "/notes?private_token=" +
      gitlabApiToken
  );

  const options: RequestOptions = {
    method: "POST",
    headers: form.getHeaders(),
  };

  const req = request(url, options, (res: IncomingMessage) => {
    const chunks: any = [];

    res.on("data", (chunk) => {
      chunks.push(chunk);
    });

    res.on("end", (chunk: any) => {
      const body = Buffer.concat(chunks);
      console.log(body.toString());
    });

    res.on("error", (error) => {
      console.error(error);
    });
  });
  form.pipe(req);
};

function getFullTestTitle(currentTest: any) {
  let fullTestTitle = currentTest.title;
  let parent = currentTest;
  while (parent.parent.title) {
    parent = parent.parent;
    fullTestTitle = parent.title + " " + fullTestTitle;
  }
  return fullTestTitle;
}

const createFailureLocalizationHooks = ({
  mochaCommand,
  targetBranch = "master",
  gitlabApiToken,
}: {
  mochaCommand: string;
  targetBranch: string;
  gitlabApiToken: string;
}) => {
  const TEMP_COVERAGE_DIR = "./tempCoverageDir";
  const changedLinesPerFile = new Map<string, number[]>();
  const faultLocalizations = new FaultLocalizations();
  const afterAllPromises: Promise<void>[] = [];

  return {
    beforeAll: async () => {
      console.log("hi from mocha before all hook");

      const repo = await Repository.open("./.git");
      const target = await repo.getReferenceCommit(targetBranch);
      const targetTree = await target.getTree();

      const diff = await Diff.treeToIndex(repo, targetTree, undefined, {
        contextLines: 0,
      });

      const patches = await diff.patches();
      for (const patch of patches) {
        const fileEnding = patch.newFile().path().split(".").pop();
        if (fileEnding !== "ts") {
          continue;
        }
        const hunks = await patch.hunks();
        const lineNumbers = [];
        for (const hunk of hunks) {
          const startLine = hunk.newStart();
          const numberOfLines = hunk.newLines();

          lineNumbers.push(
            ...Array.from(new Array(numberOfLines), (x, i) => i + startLine)
          );
        }
        changedLinesPerFile.set(patch.newFile().path(), lineNumbers);
      }
      return Promise.resolve();
    },
    afterEach: async (currentTest: any) => {
      if (currentTest.state === "failed") {
        const fullTestTitle = getFullTestTitle(currentTest);
        const currentTestPath = currentTest.file;
        faultLocalizations.addFailedTest(currentTestPath, fullTestTitle);
        console.log(
          `The test '${fullTestTitle} from the file ${currentTestPath} failed.`
        );
        const coverageDir =
          TEMP_COVERAGE_DIR + "/" + fullTestTitle.replace(/\s/g, "");
        const testCommand = `NODE_V8_COVERAGE=${coverageDir}  ${mochaCommand} ${currentTestPath} --grep "^${fullTestTitle}$"`;
        console.log("running the test again with the command: ", testCommand);
        const promise = new Promise<void>((resolve) => {
          childProcess.exec(
            testCommand,
            async (error: ExecException | null) => {
              const coverageFile =
                coverageDir + "/" + fs.readdirSync(coverageDir)[0];
              const loadedCoverage = await loadCoverage(coverageFile);
              fs.rmdirSync(coverageDir, { recursive: true });
              if (!loadedCoverage) {
                resolve();
                return;
              }

              for (const [file, lines] of changedLinesPerFile) {
                const changedLineCoverage = await convertCoverage(
                  loadedCoverage.coverage,
                  loadedCoverage.sourceMap,
                  file
                );

                if (!changedLineCoverage) {
                  continue;
                }

                lines.forEach((line: number) => {
                  if (changedLineCoverage.s[line - 1]) {
                    console.log(
                      `The test ${fullTestTitle} ran through line ${line} of the file ${file} which was recently changed!`
                    );
                    faultLocalizations.addFailedLine(
                      changedLineCoverage,
                      changedLineCoverage.path,
                      line,
                      currentTestPath
                    );
                  }
                });
                resolve();
              }
            }
          );
        });
        afterAllPromises.push(promise);
        return promise;
      }
      return Promise.resolve();
    },
    afterAll: async () => {
      if (!gitlabApiToken) {
        await Promise.all(afterAllPromises);
        addCommentsToFaultyFilesOnMergeRequest(
          faultLocalizations,
          gitlabApiToken
        );
      }
    },
  };
};

export default createFailureLocalizationHooks;
