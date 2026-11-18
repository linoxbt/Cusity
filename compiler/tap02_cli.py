"""python compiler/tap02_cli.py <netlist hex> <nIn> <nOut> <packed input hex>  ->  packed output hex"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
import tap02

nl, n_in, n_out, inp = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
a, b = tap02.parse(nl, n_in)
print(tap02.pack(tap02.outputs(tap02.run(a, b, n_in, tap02.unpack(inp, n_in)), n_out)))
