# Upload updates here

After the one-time installation of Forma Studio, upload incremental update `.zip` files into this folder and commit the upload. GitHub Actions will safely extract their repository-relative paths, apply optional deletions, commit the changed files, and remove the processed ZIP.

Do not put a ZIP inside another folder. Update ZIP entries must use paths relative to the repository root, for example `src/main.js` or `styles.css`.

To delete files in an update, include a UTF-8 file named `.update-delete.txt` at the ZIP root. Put one repository-relative file path per line. Blank lines and lines beginning with `#` are ignored. The deletion manifest is processed but is not copied into the repository.

The first installation is different: the complete Forma Studio package must be extracted and its contents uploaded to the repository root once, including the hidden `.github/workflows/` and `scripts/` folders. After that, use ZIP updates here.
