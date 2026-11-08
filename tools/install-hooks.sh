#!/bin/sh
# Run tools/leakcheck.py on everything you push. Undo: rm .git/hooks/pre-push
cd "$(git rev-parse --show-toplevel)" || exit 1
cat > .git/hooks/pre-push <<'HOOK'
#!/bin/sh
# stdin: <local ref> <local sha> <remote ref> <remote sha>
z=0000000000000000000000000000000000000000
while read lref lsha rref rsha; do
  [ "$lsha" = "$z" ] && continue                                     # deleting a branch
  if [ "$rsha" = "$z" ]; then python3 tools/leakcheck.py || exit 1    # new branch: scan it all
  else python3 tools/leakcheck.py "$rsha..$lsha" || exit 1; fi
done
HOOK
chmod +x .git/hooks/pre-push tools/leakcheck.py
echo "pre-push leak check installed"
