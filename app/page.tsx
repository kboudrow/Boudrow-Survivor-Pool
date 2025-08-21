import Image from "next/image";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <h1 className="text-4xl font-bold mb-4">Welcome to My NFL Survivor Pool</h1>
      <p className="text-lg text-gray-600">
        Survivor Pools Made Easy
      </p>
    </div>
  );
}