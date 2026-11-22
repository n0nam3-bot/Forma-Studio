# Upload incremental ZIP updates here

1. Upload the update `.zip` into this folder in the same branch configured for GitHub Pages.
2. Commit the ZIP to GitHub. Merely selecting or staging a file without committing it does not start Actions.
3. Open **Actions → Apply uploaded ZIP updates** and confirm the run is green.
4. The workflow extracts the ZIP paths at the repository root, commits the changes, and removes the processed ZIP from this folder.

Update ZIP entries must be repository-relative paths such as `src/main.js` or `styles.css`. Do not wrap incremental updates in a parent folder. Only `.zip` files placed directly inside `upload/` are processed; nested ZIPs are ignored.

To delete files, add `.update-delete.txt` at the ZIP root and list one repository-relative path per line. The manifest is consumed and is not copied into the repository.

The first installation is a one-time manual step: install the complete app at the repository root, including `.github/workflows/unpack-upload.yml` and `scripts/process_uploads.py`. GitHub cannot run a workflow that has not already been committed to the repository.

## If Actions does not run

- Confirm the ZIP was committed to the same branch selected in **Settings → Pages**.
- Confirm the workflow exists at `.github/workflows/unpack-upload.yml` on that branch.
- In **Settings → Actions → General → Workflow permissions**, select **Read and write permissions** and save.
- Check that GitHub Actions are enabled for the repository and inspect the run log for a red step. Branch protection rules can also prevent the workflow bot from pushing commits.
- A `workflow_dispatch` run can be started manually from the Actions page after a ZIP has been committed to `upload/`.
