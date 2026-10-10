### 🎨 Improvements

- **docker**: An unreadable Docker socket now names the fix in the error, which is running DBackup with `PGID` set to the group that owns the socket ([#167](https://github.com/Skyfay/DBackup/issues/167)).

### 📝 Documentation

- **docs**: The Docker Volumes guide names the group ID to run DBackup with when the socket is not readable, says why `group_add` and `user:` do not work and what to do on a host whose socket belongs to no `docker` group ([#167](https://github.com/Skyfay/DBackup/issues/167)).
