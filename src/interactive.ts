import * as vorpal from "vorpal";

vorpal
    .mode("repl")
    .description("Enters the user into a REPL session.")
    .delimiter("repl:")
    .action(function(command, callback) {
        this.log(eval(command));
    });
