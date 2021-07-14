import * as childProcess from "child_process";
import * as fs from "fs";
import { resolve } from "path";
import { convertCoverage, loadCoverage } from "./coverageConverter";
import { Diff, Repository } from "nodegit";

console.log("hooks file loaded");

interface IFaultyFile {
  path: string,
  lines: Map<string, Set<string>>,
  statements: Map<string, Set<string>>,
  functionMap: Map<string, Set<string>>,
  statementMap: Map<string, Set<string>>,
  branchMap: Map<string, Set<string>>,
}

interface IFailedTest {
  name: string,
}

interface IFaultLocalizations {
  faultyFiles: Map<string, IFaultyFile>;
  failedTests: Map<string, IFailedTest>
}

const createFaultyFile = (faultLocalizations: IFaultLocalizations, coverage: any, changedLineCoveragePath: string): IFaultyFile => {
  const faultyFile: IFaultyFile = {
    path: coverage.path,
    lines: new Map(
      Object.keys(coverage.s).map((key) => [parseInt(key) + 1 + "", new Set()])
    ),
    statements: new Map(Object.keys(coverage.s).map((key) => [key, new Set()])),
    // branches: new Map(Object.keys(coverage.b).map(key => [key, new Set()])),
    // functions: new Map(Object.keys(coverage.f).map(key => [key, new Set()])),
    functionMap: coverage.fnMap,
    statementMap: coverage.statementMap,
    branchMap: coverage.branchMap
  };
  faultLocalizations.faultyFiles.set(
    changedLineCoveragePath,
    faultyFile
  );
  return faultyFile
};


const addFailedLineToFaultyFile = (
  faultyFile: IFaultyFile,
  lineNumber: number,
  failedTestPath: string
) => {
  faultyFile.lines.get("" + lineNumber)?.add(failedTestPath);
  faultyFile.statements.get("" + (lineNumber - 1))?.add(failedTestPath);
  // faultyFile.branchesMap
  // faultyFile.branches.get(lineNumber).add(failedTestPath)
  // faultyFile.lines.get(lineNumber).add(failedTestPath)
};

const addCommentsToFaultyFilesOnMergeRequest = (faultLocalizations: IFaultLocalizations, gitlabApiToken: string) => {
  const url = process.env.CI_API_V4_URL + "/projects/" + process.env.CI_PROJECT_ID + "/merge_requests/" + process.env.CI_MERGE_REQUEST_IID + "/notes?private_token=" + gitlabApiToken;

  const formdata = new FormData();
  formdata.append("body", "Another comment through the API.");

  const requestOptions: RequestInit = {
    method: "POST",
    body: formdata,
    redirect: "follow"
  };

  fetch(url, requestOptions)
    .then(response => response.text())
    .then(result => console.log(result))
    .catch(error => console.log("error", error));
};

const createFailureLocalizationHooks = ({ mochaCommand, targetBranch = "master", gitlabApiToken }: {
  mochaCommand: any, targetBranch: string, gitlabApiToken: string
}) => {
  const TEMP_COVERAGE_DIR = "./tempCoverageDir";
  const changedLinesPerFile = new Map();
  const faultLocalizations: IFaultLocalizations = {
    faultyFiles: new Map(),
    failedTests: new Map()
  };

  return {
    beforeAll: async () => {
      console.log("hi from mocha before all hook");

      const repo = await Repository.open("./.git");
      const target = await repo.getReferenceCommit(targetBranch);
      const targetTree = await target.getTree();

      const diff = await Diff.treeToIndex(repo, targetTree, undefined, {
        contextLines: 0
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
        let fullTestTitle = currentTest.title;
        let parent = currentTest;
        while (parent.parent.title) {
          parent = parent.parent;
          fullTestTitle = parent.title + " " + fullTestTitle;
        }
        const currentTestPath = currentTest.file;
        console.log(
          "The test '" +
          fullTestTitle +
          "' from the file '" +
          currentTestPath +
          "' failed."
        );
        // run code coverage with node directly
        const coverageDir =
          TEMP_COVERAGE_DIR + "/" + fullTestTitle.replace(/\s/g, "");
        const testCommand =
          "NODE_V8_COVERAGE=" +
          coverageDir +
          " " +
          mochaCommand.replace("-r ./test/hooks.js", "") +
          " " +
          currentTestPath +
          " --grep \"^" +
          fullTestTitle +
          "$\"";
        console.log("running the test again with the command: ", testCommand);
        const promise = new Promise<void>((resolve) => {
          childProcess.exec(testCommand, async (error, stdout, stderr) => {
            if (error) {
              console.log("failed with error: " + error);
            }
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
                  const faultyFile: IFaultyFile = faultLocalizations.faultyFiles.get(
                    changedLineCoverage.path
                  ) || createFaultyFile(faultLocalizations, changedLineCoverage, changedLineCoverage.path);
                  console.log(
                    `The test ${fullTestTitle} ran through line ${line} of the file ${file} which was recently changed!`
                  );
                  // Todo: Aggregate consecutive lines and create comment on the merge request
                  addFailedLineToFaultyFile(
                    faultyFile,
                    line,
                    currentTestPath
                  );
                }
              });
              resolve();
            }
          });
        });
        return promise;
      }
      return Promise.resolve();
    },
    afterAll: async () => {
      // todo: add comment to merge request
      addCommentsToFaultyFilesOnMergeRequest(faultLocalizations,gitlabApiToken)
    }
  };
};


export default createFailureLocalizationHooks;
