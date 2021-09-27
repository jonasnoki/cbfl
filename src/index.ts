import * as childProcess from "child_process";
import * as fs from "fs";
import { convertCoverage, loadCoverage } from "./coverageConverter";
import { Diff, Oid, Repository, Revwalk } from "nodegit";
import { IncomingMessage } from "http";
import { request, RequestOptions } from "https";
import FormData from "form-data";
import { FaultLocalizations } from "./FaultLocalizations";
import { ExecException, ExecSyncOptions } from "child_process";

console.log("hooks file loaded");

interface IFailureLocalizationOptions {
  mochaCommand: string;
  targetBranch: string;
  gitlabApiToken: string;
}

async function getAllOids(repo: Repository) {
  const revwalk = Revwalk.create(repo);
  revwalk.reset();
  revwalk.sorting(Revwalk.SORT.TIME);
  const commit = await repo.getHeadCommit();
  revwalk.push(commit.id());

  // step through all OIDs for the given reference
  const allOids = [];
  let hasNext = true;
  while (hasNext) {
    try {
      const oid = await revwalk.next();
      allOids.push(oid);
    } catch (err) {
      hasNext = false;
    }
  }
  return allOids;
}

export const traverseHistory = async (mochaCommand: string) => {
  const repo = await Repository.open("./.git");
  const allOids: Oid[] = await getAllOids(repo);

  const processOptions: ExecSyncOptions = {
    stdio: "inherit",
  };

  console.log("all Oids", allOids);

  for (const oid of allOids) {
    //Todo: add error handling
    try {
      childProcess.execSync(
        `TS_NODE_FILES=true node ${__dirname}/checkoutCommit.js ${oid.tostrS()}`,
        processOptions
      );
      childProcess.execSync(`npm install mocha@7.1.2`, processOptions);
      childProcess.execSync(`npm link cbfl`, processOptions);
      childProcess.execSync(`npm install`, processOptions);
      childProcess.execSync(mochaCommand, processOptions);
    } catch (err) {
      console.log(err);
    }
  }
};

export const createFailureLocalizationHooks = ({
  mochaCommand,
  targetBranch = "master",
  gitlabApiToken,
}: IFailureLocalizationOptions) => {
  const TEMP_COVERAGE_DIR = "./tempCoverageDir";
  let commitID = "";
  const changedLinesPerFile = new Map<string, number[]>();
  const faultLocalizations = new FaultLocalizations();
  const afterAllPromises: Promise<void>[] = [];

  return {
    beforeAll: async () => {
      console.log("hi from mocha before all hook");

      const repo = await Repository.open("./.git");
      const target = await repo.getReferenceCommit(targetBranch);
      commitID = target.id().tostrS();
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
      await Promise.all(afterAllPromises);
      if (gitlabApiToken) {
        addCommentsToFaultyFilesOnMergeRequest(
          faultLocalizations,
          gitlabApiToken
        );
      } else {
        await faultLocalizations.saveToFile(commitID);
      }
      return Promise.resolve();
    },
  };
};

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
