/// Generates a shell completion script for `cmd` (the caller's top-level `clap::Command`,
/// e.g. `<Cli as clap::CommandFactory>::command()`) and writes it to stdout.
///
/// This takes the built `clap::Command` rather than a `Cli`/`Commands` type directly because
/// those clap definitions live in the binary crate (they define that binary's own command
/// surface), not in this library.
pub fn cmd_completions(shell: clap_complete::Shell, cmd: &mut clap::Command) {
    let name = cmd.get_name().to_string();
    clap_complete::generate(shell, cmd, name, &mut std::io::stdout());
}
