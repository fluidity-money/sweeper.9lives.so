for file in contracts/*.sol; do
  forge inspect $file:$(basename ${file%.*}) abi > service/abi/$(basename ${file%.*}).json
done

