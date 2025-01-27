for contract in contracts/*.sol; do
  contract_name=$(basename "$contract")
  globs="$globs out/$contract_name/*.json"
done

npx typechain --target ethers-v6 --out-dir types/contracts $globs
