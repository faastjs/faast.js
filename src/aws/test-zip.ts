import * as archiver from "archiver";
import * as fs from "fs";

const archive = archiver("zip", {
    zlib: { level: 9 } // Sets the compression level.
});

archive.directory("nm", false).finalize();
archive.pipe(fs.createWriteStream("nm-archiver.zip"));
