import * as childProcess from "child_process";
import * as fs from "fs";
import { resolve } from "path";
import { convertCoverage, loadCoverage } from "./coverageConverter";
import { Diff, Repository } from "nodegit";

console.log("hooks file loaded");

const createFaultyFile = (coverage: any) => {
  return {
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
};


const addFailedLineToFaultyFile = (
  faultyFile: any,
  lineNumber: number,
  failedTestPath: string
) => {
  faultyFile.lines.get("" + lineNumber).add(failedTestPath);
  faultyFile.statements.get("" + (lineNumber - 1)).add(failedTestPath);
  // faultyFile.branchesMap
  // faultyFile.branches.get(lineNumber).add(failedTestPath)
  // faultyFile.lines.get(lineNumber).add(failedTestPath)
};

const createFailureLocalizationHooks = ({ mochaCommand, targetBranch = "master" }: {
  mochaCommand: any, targetBranch: string
}) => {
  const TEMP_COVERAGE_DIR = "./tempCoverageDir";
  const changedLinesPerFile = new Map();
  const faultLocalizations = {
    faultyFiles: new Map(), // fileID => coverageInfo
    failedTests: new Map() // testID => testPath
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
                  if (
                    !faultLocalizations.faultyFiles.has(
                      changedLineCoverage.path
                    )
                  ) {
                    faultLocalizations.faultyFiles.set(
                      changedLineCoverage.path,
                      createFaultyFile(changedLineCoverage)
                    );
                  }
                  console.log(
                    `The test ${fullTestTitle} ran through line ${line} of the file ${file} which was recently changed!`
                  );
                  // Todo: Aggregate consecutive lines and create comment on the merge request
                  addFailedLineToFaultyFile(
                    faultLocalizations.faultyFiles.get(
                      changedLineCoverage.path
                    ),
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
    }
  };
};


export default createFailureLocalizationHooks;
