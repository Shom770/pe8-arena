# Extra tests per question, taken from the examples in each problem statement
# (plus tail-recursion stress tests where the problem says the grader uses a
# small stack). Appended after the file's own tests, except where noted.

QUEUE_SIGS = {
    3: """  val create : unit -> 'a queue
  val enq : 'a -> 'a queue -> unit
  val from_list : 'a list -> 'a queue
  val valid : 'a queue -> bool
  val is_empty : 'a queue -> bool
  val deq : 'a queue -> 'a option
  val to_list : 'a queue -> 'a list""",
    7: """  val contains : 'a -> 'a queue -> bool
  val create : unit -> 'a queue
  val enq : 'a -> 'a queue -> unit
  val to_list : 'a queue -> 'a list""",
    41: """  val delete : 'a -> 'a queue -> unit
  val create : unit -> 'a queue
  val enq : 'a -> 'a queue -> unit
  val deq : 'a queue -> 'a option
  val to_list : 'a queue -> 'a list""",
    43: """  val truncate : 'a -> 'a queue -> unit
  val valid : 'a queue -> bool
  val create : unit -> 'a queue
  val enq : 'a -> 'a queue -> unit
  val deq : 'a queue -> 'a option
  val to_list : 'a queue -> 'a list
  val length : 'a queue -> int""",
}

SET_SIGS = {
    15: """  val empty : 'a set
  val is_empty : 'a set -> bool
  val list_of_set : 'a set -> 'a list
  val add : 'a -> 'a set -> 'a set
  val remove : 'a -> 'a set -> 'a set
  val member : 'a -> 'a set -> bool
  val size : 'a set -> int
  val equals : 'a set -> 'a set -> bool
  val set_of_list : 'a list -> 'a set""",
    28: """  val empty : 'a set
  val list_of_set : 'a set -> 'a list
  val remove : 'a -> 'a set -> 'a set
  val member : 'a -> 'a set -> bool""",
    45: """  val empty : 'a set
  val list_of_set : 'a set -> 'a list
  val add : 'a -> 'a set -> 'a set
  val set_of_list : 'a list -> 'a set""",
}

# Questions whose extra tests go inside the module (before its final `end`),
# because the tests need to see the set's representation.
INSIDE_MODULE = {28}

DEQUE_HELPERS = """
(* Test helpers: build a deque by hand and check its links. *)
let deque_of_list (l : 'a list) : 'a deque =
  let d = { head = None; tail = None } in
  let rec go (l : 'a list) : unit =
    begin match l with
    | [] -> ()
    | x :: rest ->
      let n = { v = x; next = None; prev = d.tail } in
      begin match d.tail with
      | None -> d.head <- Some n
      | Some t -> t.next <- Some n
      end;
      d.tail <- Some n;
      go rest
    end
  in
  go l; d

(* Elements read from head to tail by following next pointers. *)
let forward_list (q : 'a deque) : 'a list =
  let rec loop (no : 'a dqnode option) (acc : 'a list) : 'a list =
    begin match no with
    | None -> List.rev acc
    | Some n -> loop n.next (n.v :: acc)
    end
  in
  loop q.head []

let ends_ok (q : 'a deque) : bool =
  begin match q.head, q.tail with
  | None, None -> true
  | Some h, Some t ->
    (match h.prev with None -> true | Some _ -> false)
    && (match t.next with None -> true | Some _ -> false)
  | _ -> false
  end

let consistent (q : 'a deque) : bool =
  ends_ok q && forward_list q = to_list q
"""

EXTRAS = {
1: """
let test () : bool = contains_zero [1; 0; 2]
;; run_test "contains_zero: zero in the middle" test
let test () : bool = not (contains_zero [1; 2; 3])
;; run_test "contains_zero: no zero" test
let test () : bool = not (contains_zero [])
;; run_test "contains_zero: empty list" test
let test () : bool = contains_zero [5; 6; 0]
;; run_test "contains_zero: zero at the end" test
""",
2: """
let test () : bool = in_range 1 10 5
;; run_test "in_range: inside" test
let test () : bool = in_range 1 10 1 && in_range 1 10 10
;; run_test "in_range: endpoints count" test
let test () : bool = not (in_range 1 10 11) && not (in_range 1 10 0)
;; run_test "in_range: outside" test
let test () : bool = not (in_range 10 1 5)
;; run_test "in_range: empty range" test
""",
3: """
let test () : bool =
  let q = LinkedQueue.from_list [] in
  LinkedQueue.is_empty q && LinkedQueue.valid q
;; run_test "from_list: empty list" test
let test () : bool =
  let q = LinkedQueue.from_list [7] in
  LinkedQueue.valid q && LinkedQueue.to_list q = [7]
;; run_test "from_list: one element" test
let test () : bool =
  let q = LinkedQueue.from_list [1; 2; 3] in
  LinkedQueue.enq 4 q;
  LinkedQueue.valid q && LinkedQueue.to_list q = [1; 2; 3; 4]
;; run_test "from_list: tail is set so enq still works" test
let test () : bool =
  let l = tr_init stress_n (fun i -> i) in
  let q = LinkedQueue.from_list l in
  LinkedQueue.valid q && LinkedQueue.to_list q = l
;; run_test "from_list: large input (tail recursion)" test
""",
4: """
let test () : bool = count_negatives [1; -2; 3; -4] = 2
;; run_test "count_negatives: mixed" test
let test () : bool = count_negatives [1; 2; 3] = 0
;; run_test "count_negatives: none" test
let test () : bool = count_negatives [0] = 0
;; run_test "count_negatives: zero is not negative" test
let test () : bool = count_negatives [] = 0
;; run_test "count_negatives: empty" test
""",
5: """
let test () : bool = swap_pairs [(1, "a"); (2, "b")] = [("a", 1); ("b", 2)]
;; run_test "swap_pairs: two pairs" test
let test () : bool = swap_pairs [(7, "x")] = [("x", 7)]
;; run_test "swap_pairs: one pair" test
let test () : bool = swap_pairs [] = []
;; run_test "swap_pairs: empty" test
""",
6: """
let test () : bool = concat [[1; 2]; [3]; [4; 5; 6]] = [1; 2; 3; 4; 5; 6]
;; run_test "concat: example from the problem" test
let test () : bool = concat [] = []
;; run_test "concat: empty outer list" test
let test () : bool = concat [["a"]; []; ["b"; "c"]] = ["a"; "b"; "c"]
;; run_test "concat: strings with an empty list inside" test
""",
7: """
let test () : bool =
  not (LinkedQueue.contains 1 (LinkedQueue.create ()))
;; run_test "contains: empty queue" test
let test () : bool =
  let q = LinkedQueue.create () in
  let r = ref 2 in
  LinkedQueue.enq (ref 1) q; LinkedQueue.enq r q; LinkedQueue.enq (ref 3) q;
  let _ = LinkedQueue.contains r q in
  List.length (LinkedQueue.to_list q) = 3
;; run_test "contains: does not change the queue" test
let test () : bool =
  let q = LinkedQueue.create () in
  let rs = tr_init stress_n (fun i -> ref i) in
  List.iter (fun r -> LinkedQueue.enq r q) rs;
  LinkedQueue.contains (List.nth rs (stress_n - 1)) q
  && not (LinkedQueue.contains (ref (stress_n - 1)) q)
;; run_test "contains: large input (tail recursion)" test
""",
8: """
let test () : bool = is_sorted [1; 1; 2]
;; run_test "is_sorted: repeated elements" test
let test () : bool = not (is_sorted [1; 3; 2])
;; run_test "is_sorted: out of order at the end" test
""",
9: """
let test () : bool = guess_parent_helix [T; C; A] [G; C; A] = [A; C; A]
;; run_test "guess_parent_helix: example from the problem" test
let test () : bool = guess_parent_helix [] [] = []
;; run_test "guess_parent_helix: empty helices" test
let test () : bool = guess_parent_helix [G; T] [G; T] = [G; T]
;; run_test "guess_parent_helix: identical helices" test
""",
10: """
let test () : bool = double_all [1; 2; 3] = [2; 4; 6]
;; run_test "double_all: positives" test
let test () : bool = double_all [-2; 0] = [-4; 0]
;; run_test "double_all: negative and zero" test
let test () : bool = double_all [] = []
;; run_test "double_all: empty" test
""",
11: """
let test () : bool =
  let r1 = { count = 5 } in
  not (contains_alias r1 [])
;; run_test "contains_alias: empty list" test
let test () : bool =
  let r1 = { count = 5 } in
  contains_alias_option r1 [None; Some r1]
;; run_test "contains_alias_option: alias after a None" test
let test () : bool =
  let r1 = { count = 5 } in
  not (contains_alias_option r1 [None; None])
;; run_test "contains_alias_option: only Nones" test
""",
12: """
let test () : bool = exists [true]
;; run_test "exists: [true]" test
let test () : bool = exists [false; false; true]
;; run_test "exists: true at the end" test
""",
13: """
let test () : bool = last [1; 2; 3] = 3
;; run_test "last: three elements" test
let test () : bool = last [5] = 5
;; run_test "last: one element" test
let test () : bool =
  (try ignore (last []); false with Failure msg -> msg = "empty")
;; run_test "last: empty list fails with \\"empty\\"" test
""",
14: """
let test () : bool = cat_option [None; None] = []
;; run_test "cat_option: only Nones" test
let test () : bool = cat_option [] = []
;; run_test "cat_option: empty" test
let test () : bool =
  partial_transform (fun x -> if x > 0 then Some (x * 2) else None) [1; -1; 2] = [2; 4]
;; run_test "partial_transform: uses cat_option" test
""",
15: """
let test () : bool = BSTSet.size BSTSet.empty = 0
;; run_test "BSTSet.size: empty" test
let test () : bool = BSTSet.size (BSTSet.set_of_list [1; 2; 3; 5]) = 4
;; run_test "BSTSet.size: four elements" test
let test () : bool = BSTSet.size (BSTSet.set_of_list [1; 2; 1; 1]) = 2
;; run_test "BSTSet.size: duplicates collapse" test
""",
16: """
let test () : bool = product [2; 3; 4] = 24
;; run_test "product: three elements" test
let test () : bool = product [5] = 5
;; run_test "product: one element" test
let test () : bool = product [1; 0; 7] = 0
;; run_test "product: contains zero" test
let test () : bool = product [] = 1
;; run_test "product: empty list is 1" test
""",
17: """
let test () : bool = keep_positives [3; -1; 0; 7] = [3; 7]
;; run_test "keep_positives: mixed" test
let test () : bool = keep_positives [-2; -5] = []
;; run_test "keep_positives: none" test
let test () : bool = keep_positives [] = []
;; run_test "keep_positives: empty" test
""",
18: """
let add1 (x : int) : int = x + 1
let double (x : int) : int = x * 2
let test () : bool = compose add1 double 5 = 11
;; run_test "compose: double first, then add1" test
let test () : bool = compose double add1 5 = 12
;; run_test "compose: add1 first, then double" test
let test () : bool = compose string_of_int add1 41 = "42"
;; run_test "compose: change of type" test
""",
19: """
let test () : bool = sum_pairs [(1, 2); (3, 4)] = [3; 7]
;; run_test "sum_pairs: two pairs" test
let test () : bool = sum_pairs [(5, -5)] = [0]
;; run_test "sum_pairs: one pair" test
let test () : bool = sum_pairs [] = []
;; run_test "sum_pairs: empty" test
""",
20: """
let test () : bool = is_bst Empty
;; run_test "is_bst: empty" test
let test () : bool = is_bst (Node (Node (Empty, 1, Empty), 5, Node (Empty, 9, Empty)))
;; run_test "is_bst: small valid tree" test
let test () : bool = not (is_bst (Node (Node (Empty, 9, Empty), 5, Node (Empty, 1, Empty))))
;; run_test "is_bst: children swapped" test
let test () : bool = not (is_bst (Node (Node (Empty, 5, Empty), 5, Empty)))
;; run_test "is_bst: repeated label" test
let test () : bool =
  not (is_bst (Node (Node (Empty, 1, Node (Empty, 9, Empty)), 5, Empty)))
;; run_test "is_bst: deep violation (9 left of 5)" test
""",
21: """
let test () : bool = sale_price 1000 25 = 750
;; run_test "sale_price: 25 percent off" test
let test () : bool = sale_price 999 10 = 900
;; run_test "sale_price: fraction of a cent dropped" test
let test () : bool = sale_price 5 50 = 3
;; run_test "sale_price: multiply before dividing" test
let test () : bool = sale_price 100 0 = 100
;; run_test "sale_price: no discount" test
""",
22: """
let test () : bool = sum_first_two [3; 4; 5] = 7
;; run_test "sum_first_two: only the first two" test
let test () : bool = sum_first_two [3; 4] = 7
;; run_test "sum_first_two: exactly two" test
let test () : bool = sum_first_two [7] = 7
;; run_test "sum_first_two: one element" test
let test () : bool = sum_first_two [] = 0
;; run_test "sum_first_two: empty" test
""",
23: """
let test () : bool = hamming_distance [G; A; G] [A; G; G] = 2
;; run_test "hamming_distance: example from the problem" test
let test () : bool = hamming_distance [] [] = 0
;; run_test "hamming_distance: empty helices" test
""",
24: """
let test () : bool = count_leaves (Leaf []) = 1
;; run_test "count_leaves: single leaf" test
let test () : bool = count_leaves (Node (Node (Leaf [], Leaf []), Leaf [])) = 3
;; run_test "count_leaves: unbalanced tree" test
""",
25: """
let test () : bool = acids_of_helix [T; A; C; A; C; T] = [Met]
;; run_test "acids_of_helix: Met then END" test
let test () : bool = acids_of_helix [A; G; T; A; G; C; C; A; T; C; G; G] = []
;; run_test "acids_of_helix: no start codon" test
let test () : bool = acids_of_helix [] = []
;; run_test "acids_of_helix: empty helix" test
""",
26: """
let test () : bool = tree_transform string_of_int Empty = Empty
;; run_test "tree_transform: empty" test
let test () : bool =
  tree_transform (fun (x : int) -> x * 2)
    (Node (Node (Empty, 1, Empty), 2, Node (Empty, 3, Empty)))
  = Node (Node (Empty, 2, Empty), 4, Node (Empty, 6, Empty))
;; run_test "tree_transform: doubling" test
let test () : bool =
  tree_transform (fun (x : int) -> x > 1) (Node (Empty, 1, Node (Empty, 2, Empty)))
  = Node (Empty, false, Node (Empty, true, Empty))
;; run_test "tree_transform: change of type" test
""",
27: """
let test () : bool = rainfall [2; -2; 2; -999; 4] = 2
;; run_test "rainfall: faulty reading and data after -999" test
let test () : bool = rainfall [-2; -3] = -1
;; run_test "rainfall: only faulty readings" test
let test () : bool = rainfall [] = -1
;; run_test "rainfall: empty" test
""",
28: """
  let test () : bool = list_of_set (remove 4 [1; 2; 3; 4]) = [1; 2; 3]
  ;; run_test "OrderedListSet.remove: last element" test
  let test () : bool = list_of_set (remove 5 [1; 2; 3; 4]) = [1; 2; 3; 4]
  ;; run_test "OrderedListSet.remove: not present" test
  let test () : bool = list_of_set (remove 2 [1; 3; 4; 2]) = [1; 3; 4; 2]
  ;; run_test "OrderedListSet.remove: short-circuits past x" test
  let test () : bool = list_of_set (remove 2 [1; 2; 2; 2]) = [1; 2; 2]
  ;; run_test "OrderedListSet.remove: stops after the first match" test
""",
29: """
let test () : bool = in_both ["a"; "b"; "a"] ["a"] = ["a"; "a"]
;; run_test "in_both: keeps repeats from names1" test
let test () : bool = in_both ["x"; "y"; "z"] ["z"; "x"] = ["x"; "z"]
;; run_test "in_both: order of names1" test
""",
30: """
let test () : bool = not (is_perfect (Node (leaf 1, 2, Empty)))
;; run_test "is_perfect: one child" test
let test () : bool = not (is_perfect (Node (leaf 1, 2, Node (leaf 3, 4, leaf 5))))
;; run_test "is_perfect: leaves at different depths" test
let test () : bool = is_perfect (Node (leaf 1, 2, leaf 3))
;; run_test "is_perfect: three nodes" test
""",
31: """
let test () : bool = merge_sorted [] [1; 2] = [1; 2]
;; run_test "merge_sorted: first list empty" test
let test () : bool = merge_sorted [1; 3; 3] [2; 3] = [1; 2; 3; 3; 3]
;; run_test "merge_sorted: duplicates kept" test
""",
32: DEQUE_HELPERS + """
let test () : bool =
  let d = deque_of_list [1] in
  remove_head d = 1 && is_empty d && consistent d
;; run_test "remove_head: only element leaves both ends None" test
let test () : bool =
  let d = deque_of_list [1] in
  remove_tail d = 1 && is_empty d && consistent d
;; run_test "remove_tail: only element leaves both ends None" test
let test () : bool =
  let d = deque_of_list [1; 2; 3] in
  remove_head d = 1 && consistent d && to_list d = [2; 3]
;; run_test "remove_head: new head's prev is None" test
let test () : bool =
  let d = deque_of_list [1; 2; 3] in
  remove_tail d = 3 && consistent d && to_list d = [1; 2]
;; run_test "remove_tail: new tail's next is None" test
;; run_failing_test "remove_head: empty deque fails"
     (fun () -> let _ = remove_head (create ()) in true)
;; run_failing_test "remove_tail: empty deque fails"
     (fun () -> let _ = remove_tail (create ()) in true)
""",
33: """
let test () : bool = coins 0 = 0
;; run_test "coins 0" test
let test () : bool = coins 25 = 1
;; run_test "coins 25" test
let test () : bool = coins 41 = 4
;; run_test "coins 41 (quarter, dime, nickel, penny)" test
""",
34: DEQUE_HELPERS + """
let test () : bool =
  let d = create () in
  insert_tail 1 d;
  consistent d && to_list d = [1]
  && (match d.head, d.tail with Some h, Some t -> h == t | _ -> false)
;; run_test "insert_tail: into empty sets head and tail" test
let test () : bool =
  let d = create () in
  insert_head 1 d;
  consistent d && to_list d = [1]
  && (match d.head, d.tail with Some h, Some t -> h == t | _ -> false)
;; run_test "insert_head: into empty sets head and tail" test
let test () : bool =
  let d = create () in
  insert_head 2 d; insert_tail 3 d; insert_head 1 d; insert_tail 4 d;
  consistent d && to_list d = [1; 2; 3; 4]
;; run_test "insert_head/insert_tail: links agree both ways" test
""",
35: """
let test () : bool =
  let acc = ref [] in
  iter (fun x -> acc := x :: !acc) [1; 2; 3];
  !acc = [3; 2; 1]
;; run_test "iter: visits elements in order" test
let test () : bool =
  let r1 = { count = 5 } in
  states_aliased r1 r1
;; run_test "states_aliased: same record" test
let test () : bool =
  let r = { count = 4 } in
  swap r r; r.count = 4
;; run_test "swap: a record with itself" test
""",
36: """
let test () : bool = not (is_labeled_tree Empty)
;; run_test "is_labeled_tree: Empty" test
let test () : bool = is_labeled_tree (Node (Empty, 1, Empty))
;; run_test "is_labeled_tree: single node" test
let test () : bool = not (is_labeled_tree (Node (Node (Empty, 1, Empty), 2, Empty)))
;; run_test "is_labeled_tree: one child" test
let test () : bool =
  is_labeled_tree (Node (Node (Empty, 1, Empty), 2, Node (Empty, 3, Empty)))
;; run_test "is_labeled_tree: two leaves" test
""",
37: """
let test () : bool = add_ancestor_labels (Leaf [A]) = LLeaf [A]
;; run_test "add_ancestor_labels: single leaf" test
let test () : bool =
  add_ancestor_labels (Node (Leaf [G; T], Leaf [G; A]))
  = LNode (LLeaf [G; T], [G; A], LLeaf [G; A])
;; run_test "add_ancestor_labels: two leaves" test
""",
38: """
let test () : bool = parent_child_hamming (LLeaf [A]) = 0
;; run_test "parent_child_hamming: single leaf" test
""",
39: """
let test () : bool = count_leaves Empty = 0
;; run_test "count_leaves: empty" test
let test () : bool = count_leaves (Node (Empty, 7, Empty)) = 1
;; run_test "count_leaves: single node" test
let test () : bool =
  count_leaves (Node (Node (Empty, 1, Empty), 3,
                      Node (Empty, 2, Node (Empty, 4, Empty)))) = 2
;; run_test "count_leaves: nodes with one child are not leaves" test
""",
40: """
let test () : bool = not (sublist [1] [])
;; run_test "sublist: nonempty in empty" test
let test () : bool = sublist [1; 2; 1] [1; 1; 2; 1]
;; run_test "sublist: overlapping false start" test
""",
41: """
let test () : bool =
  let q = LinkedQueue.create () in
  List.iter (fun x -> LinkedQueue.enq x q) [1; 2; 2; 3];
  LinkedQueue.delete 2 q;
  LinkedQueue.to_list q = [1; 3]
;; run_test "delete: middle occurrences" test
let test () : bool =
  let q = LinkedQueue.create () in
  List.iter (fun x -> LinkedQueue.enq x q) [1; 1];
  LinkedQueue.delete 1 q;
  LinkedQueue.to_list q = [] && LinkedQueue.deq q = None
;; run_test "delete: everything" test
let test () : bool =
  let q = LinkedQueue.create () in
  List.iter (fun x -> LinkedQueue.enq x q) [1; 2; 3];
  LinkedQueue.delete 3 q;
  LinkedQueue.enq 4 q;
  LinkedQueue.to_list q = [1; 2; 4]
;; run_test "delete: tail updated so enq still works" test
let test () : bool =
  let q = LinkedQueue.create () in
  LinkedQueue.delete 1 q;
  LinkedQueue.to_list q = []
;; run_test "delete: empty queue" test
let test () : bool =
  let q = LinkedQueue.create () in
  for i = 0 to stress_n - 1 do LinkedQueue.enq (i mod 2) q done;
  LinkedQueue.delete 0 q;
  List.length (LinkedQueue.to_list q) = stress_n / 2
;; run_test "delete: large input (tail recursion)" test
""",
42: """
let test () : bool =
  let t1 = LNode (LLeaf [A], [T], LLeaf [C]) in
  simplest_evtree [t1; LLeaf [A]] = (LLeaf [A], 0)
;; run_test "simplest_evtree: leaf is simplest" test
let test () : bool =
  let t1 = LNode (LLeaf [A], [T], LLeaf [C]) in
  let t3 = LNode (LLeaf [G], [T], LLeaf [C]) in
  simplest_evtree [t1; t3] = (t1, 2)
;; run_test "simplest_evtree: tie goes to the first" test
;; run_failing_test "simplest_evtree: empty list fails"
     (fun () -> let _ = simplest_evtree [] in true)
""",
43: """
let make (l : int list) : int LinkedQueue.queue =
  let q = LinkedQueue.create () in
  List.iter (fun x -> LinkedQueue.enq x q) l; q
let test () : bool =
  let q = make [1; 2; 3; 4] in
  LinkedQueue.truncate 2 q;
  LinkedQueue.valid q && LinkedQueue.to_list q = [1; 2]
;; run_test "truncate: cut after 2" test
let test () : bool =
  let q = make [1; 2; 3] in
  LinkedQueue.truncate 5 q;
  LinkedQueue.valid q && LinkedQueue.to_list q = [1; 2; 3]
;; run_test "truncate: element not present" test
let test () : bool =
  let q = make [1; 2; 3; 4] in
  LinkedQueue.truncate 2 q; LinkedQueue.enq 9 q;
  LinkedQueue.valid q && LinkedQueue.to_list q = [1; 2; 9]
;; run_test "truncate: tail updated so enq still works" test
let test () : bool =
  let q = make (tr_init stress_n (fun i -> i)) in
  LinkedQueue.truncate (stress_n / 2) q;
  LinkedQueue.valid q && LinkedQueue.length q = stress_n / 2 + 1
;; run_test "truncate: large input (tail recursion)" test
""",
44: """
let test () : bool =
  let t = delete 5 (Node (leaf 2, 5, leaf 7)) in
  inorder t = [2; 7]
;; run_test "delete: root with two children" test
let test () : bool =
  let t = Node (Node (leaf 1, 2, leaf 3), 5, Node (leaf 6, 8, leaf 9)) in
  inorder (delete 8 t) = [1; 2; 3; 5; 6; 9]
  && inorder (delete 2 t) = [1; 3; 5; 6; 8; 9]
;; run_test "delete: inner nodes with two children" test
""",
45: """
let test () : bool =
  OrderedListSet.list_of_set (OrderedListSet.add 3 (OrderedListSet.set_of_list [1; 2; 3]))
  = [1; 2; 3]
;; run_test "OrderedListSet.add: already present" test
let test () : bool =
  OrderedListSet.list_of_set (OrderedListSet.add 1 OrderedListSet.empty) = [1]
;; run_test "OrderedListSet.add: into empty" test
let test () : bool =
  OrderedListSet.list_of_set (OrderedListSet.set_of_list [5; 1; 4; 1; 9; 0])
  = [0; 1; 4; 5; 9]
;; run_test "OrderedListSet.add: sorted, no duplicates" test
""",
46: DEQUE_HELPERS + """
let test () : bool =
  let d = create () in
  reverse d; to_list d = [] && consistent d
;; run_test "reverse: empty deque" test
let test () : bool =
  let d = deque_of_list [1] in
  reverse d; to_list d = [1] && consistent d
;; run_test "reverse: one element" test
let test () : bool =
  let d = deque_of_list [1; 2; 3; 4] in
  let old_head = d.head in
  reverse d;
  consistent d && to_list d = [4; 3; 2; 1]
  && (match old_head, d.tail with Some a, Some b -> a == b | _ -> false)
;; run_test "reverse: same nodes, links agree both ways" test
let test () : bool =
  let l = tr_init stress_n (fun i -> i) in
  let d = deque_of_list l in
  reverse d;
  consistent d && to_list d = List.rev l
;; run_test "reverse: large input (tail recursion)" test
""",
}
