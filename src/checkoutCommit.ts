import { Checkout, Commit, Diff, Repository, Revwalk } from "nodegit";
(async () => {
  const commitId = process.argv[2];

  const repo = await Repository.open("./.git");
  const commit = await Commit.lookup(repo, commitId);

  Checkout.tree(repo, commit, { checkoutStrategy: Checkout.STRATEGY.FORCE });

  return repo.setHeadDetached(commit.id());
})();
